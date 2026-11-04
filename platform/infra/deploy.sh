#!/usr/bin/env bash
# Build and deploy the MarketClue platform to AWS (profile "marketclue", us-west-2).
# Usage: infra/deploy.sh [--frontend-only | --backend-only | --staging]
#   --staging uploads only the frontend, to /staging/ on the live site, for checks before release.
set -euo pipefail

cd "$(dirname "$0")/.."
PROFILE=${AWS_PROFILE:-marketclue}
REGION=${AWS_REGION:-us-west-2}
STACK=marketclue
CONF=${MARKETCLUE_CONF:-$HOME/.config/marketclue}
AWS="aws --profile $PROFILE --region $REGION"

ACCOUNT=$($AWS sts get-caller-identity --query Account --output text)
GOOGLE_CLIENT_ID=$(cat "$CONF/google_client_id")
OWNER_EMAILS=$(cat "$CONF/owner_emails" 2>/dev/null || true)
RESEARCH_MODEL=$(cat "$CONF/research_model" 2>/dev/null || echo claude-opus-5-5)
BUDGET_EMAIL=$(cat "$CONF/budget_email")
# Stack parameters keep their previous value unless passed, so pass the ones whose defaults change.
IMAGE_MODEL=$(cat "$CONF/openai_image_model" 2>/dev/null || echo gpt-image-2)

put_secret() { # name file-or-generator
  if ! $AWS ssm get-parameter --name "/marketclue/$1" >/dev/null 2>&1; then
    $AWS ssm put-parameter --name "/marketclue/$1" --type SecureString --value "$2" >/dev/null
    echo "created /marketclue/$1"
  fi
}

MODE=${1:-}
if [[ "$MODE" != "--frontend-only" && "$MODE" != "--staging" ]]; then
  put_secret anthropic_api_key "$(cat "$CONF/anthropic.key")"
  put_secret session_secret "$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  # eBay seller template: optional keys from the eBay Developer Program (production keyset).
  for name in ebay_client_id ebay_client_secret; do
    if [[ -s "$CONF/$name" ]]; then put_secret "$name" "$(cat "$CONF/$name")"; fi
  done

  BUILD=$(mktemp -d)
  trap 'rm -rf "$BUILD"' EXIT
  python3 -m pip install -q -r backend/requirements.txt -t "$BUILD/pkg" \
    --platform manylinux2014_x86_64 --implementation cp --python-version 3.12 --only-binary=:all:
  cp -r backend/app "$BUILD/pkg/"
  find "$BUILD/pkg" -name __pycache__ -prune -exec rm -rf {} +
  cp infra/template.yaml "$BUILD/template.yaml"

  ARTIFACTS="marketclue-artifacts-$ACCOUNT"
  $AWS s3api head-bucket --bucket "$ARTIFACTS" 2>/dev/null || \
    $AWS s3api create-bucket --bucket "$ARTIFACTS" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null

  SITE_ORIGIN=$($AWS cloudformation describe-stacks --stack-name $STACK \
    --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text 2>/dev/null || true)
  [[ "$SITE_ORIGIN" == "None" ]] && SITE_ORIGIN=""

  $AWS cloudformation package --template-file "$BUILD/template.yaml" --s3-bucket "$ARTIFACTS" \
    --output-template-file "$BUILD/packaged.yaml" >/dev/null
  $AWS cloudformation deploy --template-file "$BUILD/packaged.yaml" --stack-name $STACK \
    --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset \
    --parameter-overrides GoogleClientId="$GOOGLE_CLIENT_ID" OwnerEmails="$OWNER_EMAILS" \
      BudgetEmail="$BUDGET_EMAIL" SiteOrigin="$SITE_ORIGIN" ResearchModel="$RESEARCH_MODEL" OpenAIImageModel="$IMAGE_MODEL"

  NEW_ORIGIN=$($AWS cloudformation describe-stacks --stack-name $STACK \
    --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text)
  if [[ "$NEW_ORIGIN" != "$SITE_ORIGIN" ]]; then
    $AWS cloudformation deploy --template-file "$BUILD/packaged.yaml" --stack-name $STACK \
      --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset \
      --parameter-overrides GoogleClientId="$GOOGLE_CLIENT_ID" OwnerEmails="$OWNER_EMAILS" \
        BudgetEmail="$BUDGET_EMAIL" SiteOrigin="$NEW_ORIGIN" ResearchModel="$RESEARCH_MODEL" OpenAIImageModel="$IMAGE_MODEL"
  fi
fi

out() { $AWS cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
SITE_BUCKET=$(out SiteBucketName)
DIST=$(out DistributionId)

if [[ "$MODE" == "--backend-only" ]]; then echo "Backend deployed; frontend unchanged."; exit 0; fi
if [[ ! -d frontend ]]; then echo "No frontend yet; skipped upload."; echo "Site: $(out SiteUrl)"; exit 0; fi
PREFIX=""
[[ "$MODE" == "--staging" ]] && PREFIX="staging/"
STAGE=$(mktemp -d)
cp -r frontend/. "$STAGE/"
printf 'window.MC_CONFIG = {googleClientId: "%s", apiBase: "/api", mock: false};\n' "$GOOGLE_CLIENT_ID" > "$STAGE/config.js"
$AWS s3 sync "$STAGE/" "s3://$SITE_BUCKET/$PREFIX" --delete --cache-control "no-cache" >/dev/null
rm -rf "$STAGE"
$AWS cloudfront create-invalidation --distribution-id "$DIST" --paths "/${PREFIX}*" >/dev/null
echo "Site: $(out SiteUrl)/$PREFIX"
