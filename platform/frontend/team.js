// Team page (#/team[?team=<id>]) and invite acceptance (#/join/<token>). SPEC v3 "Teams", v5: a person
// can be in several teams (team picker), and a team shares finished reports through its projects.
import {
  h, icon, setTitle, toast, copyText, avatar, fmtDate, fmtAgo, confirmDialog, plural, emptyState,
} from "./ui.js";
import { api, friendlyError } from "./api.js";
import { state, main, page, pageHeader, loadingBlock, go, rerender, routeQuery } from "./core.js";
import { refreshProjects, resetTeamsCache, openNewProjectDialog, projectHref } from "./projects.js";

function inviteLink(inv) {
  if (inv.invite_url) return inv.invite_url;
  return `${location.origin}${location.pathname}${location.search}#/join/${encodeURIComponent(inv.token)}`;
}

const teamHref = (id) => `#/team?team=${encodeURIComponent(id)}`;

export async function viewTeam(isCurrent) {
  setTitle("Team");
  main.replaceChildren(loadingBlock("Loading your teams…"));
  const raw = await api("/teams");
  if (!isCurrent()) return;
  const teams = Array.isArray(raw) ? raw : Array.isArray(raw?.teams) ? raw.teams : [];
  if (!teams.length) return renderNoTeam(isCurrent);
  const wanted = routeQuery().get("team");
  const current = teams.find((t) => t.team_id === wanted) || teams[0];
  let data;
  try {
    data = await api(`/teams/${encodeURIComponent(current.team_id)}`);
  } catch (err) {
    if (!isCurrent()) return;
    if (err.status === 404 && current !== teams[0]) return go(teamHref(teams[0].team_id), true);
    throw err;
  }
  if (!isCurrent()) return;
  return renderTeam(data, teams, isCurrent);
}

function createTeamForm(isCurrent, { idPrefix = "team", heading = "Create a team" } = {}) {
  const name = h("input", { type: "text", id: `${idPrefix}-name`, maxlength: "80", autocomplete: "organization", required: true, "aria-describedby": `${idPrefix}-name-hint` });
  const error = h("p", { class: "form-error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Create team");
  const form = h("form", { class: "stack", novalidate: true },
    heading ? h("h2", {}, heading) : null,
    h("div", { class: "control" },
      h("label", { for: `${idPrefix}-name` }, "Team name"),
      name,
      h("p", { class: "field-hint", id: `${idPrefix}-name-hint` }, "For example, your business name. You become the team owner.")),
    error,
    h("div", { class: "form-actions" }, submit));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const value = name.value.trim();
    if (!value) {
      error.textContent = "Enter a team name.";
      name.setAttribute("aria-invalid", "true");
      name.focus();
      return;
    }
    name.removeAttribute("aria-invalid");
    submit.disabled = true;
    error.textContent = "";
    try {
      const data = await api("/teams", { method: "POST", body: { name: value } });
      resetTeamsCache();
      if (!isCurrent()) return;
      toast("Team created.");
      const id = data.team?.team_id;
      if (id) go(teamHref(id));
      else rerender();
    } catch (err) {
      submit.disabled = false;
      error.textContent = friendlyError(err);
    }
  });
  return form;
}

function renderNoTeam(isCurrent) {
  const form = h("div", { class: "surface form-card" }, createTeamForm(isCurrent));
  main.replaceChildren(page(
    pageHeader({
      title: "Team",
      lede: "Share projects with the people you work with: their finished reports and fact cards. Conversations and reports in progress stay private to their author.",
    }),
    h("div", { class: "team-grid" },
      form,
      h("section", { class: "surface form-card", "aria-labelledby": "how-h" },
        h("h2", { id: "how-h" }, "How teams work"),
        h("ul", { class: "check-list" },
          h("li", {}, "The owner invites people by email and shares an invite link."),
          h("li", {}, "Invites last 7 days and only work for the invited Google account."),
          h("li", {}, "Members see the team's projects: finished reports and fact cards."),
          h("li", {}, "You can be in several teams."),
          h("li", {}, "Removing a member ends their access at once."))))));
}

function memberRow(m, { me, canRemove, onRemove }) {
  const isMe = m.sub === me;
  return h("li", { class: "member-row" },
    avatar(m),
    h("div", { class: "member-main" },
      h("p", { class: "member-name" }, m.name || m.email, isMe ? h("span", { class: "muted" }, " (you)") : null),
      h("p", { class: "member-meta" }, [m.email, m.joined_at ? `joined ${fmtDate(m.joined_at)}` : null].filter(Boolean).join(" · "))),
    h("span", { class: `badge ${m.role === "owner" ? "badge-owner" : "badge-neutral"}` }, m.role === "owner" ? "Owner" : "Member"),
    canRemove && !isMe
      ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => onRemove(m) },
          "Remove", h("span", { class: "visually-hidden" }, ` ${m.name || m.email}`))
      : null);
}

function renderTeam(data, teams, isCurrent) {
  const { team, role } = data;
  const members = Array.isArray(data.members) ? data.members : [];
  const invites = (Array.isArray(data.invites) ? data.invites : []).filter((i) => !i.status || i.status === "pending");
  const projects = (Array.isArray(data.projects) ? data.projects : []).filter((p) => p && p.project_id && !p.archived);
  const isTeamOwner = role === "owner";
  const me = state.user && state.user.sub;
  const base = `/teams/${encodeURIComponent(team.team_id)}`;
  setTitle(team.name || "Team");

  async function removeMember(m) {
    const ok = await confirmDialog({
      title: `Remove ${m.name || m.email}?`,
      body: "They lose access to the team's reports and fact cards immediately. Their own reports stay in their account.",
      confirmLabel: "Remove member", danger: true,
    });
    if (!ok) return;
    try {
      await api(`${base}/members/${encodeURIComponent(m.sub)}`, { method: "DELETE" });
      toast(`${m.name || m.email} was removed from the team.`);
      if (isCurrent()) rerender();
    } catch (err) {
      toast(friendlyError(err));
    }
  }

  async function revoke(inv) {
    const ok = await confirmDialog({
      title: `Revoke the invite for ${inv.email}?`,
      body: "The invite link stops working. You can invite them again later.",
      confirmLabel: "Revoke invite", danger: true,
    });
    if (!ok) return;
    try {
      await api(`${base}/invites/${encodeURIComponent(inv.token)}`, { method: "DELETE" });
      toast("Invite revoked.");
      if (isCurrent()) rerender();
    } catch (err) {
      toast(friendlyError(err));
    }
  }

  async function leave() {
    const ok = await confirmDialog({
      title: `Leave ${team.name}?`,
      body: "You will no longer see the team's projects, reports and fact cards. Your own reports stay in your account.",
      confirmLabel: "Leave team", danger: true,
    });
    if (!ok) return;
    try {
      await api(`${base}/leave`, { method: "POST" });
      resetTeamsCache();
      refreshProjects();
      toast("You left the team.");
      if (isCurrent()) go("#/team");
    } catch (err) {
      toast(friendlyError(err));
    }
  }

  const sections = [];
  sections.push(h("section", { class: "surface form-card", "aria-labelledby": "team-projects-h" },
    h("div", { class: "card-head" },
      h("h2", { id: "team-projects-h" }, "Team projects"),
      h("button", { type: "button", class: "btn btn-secondary btn-sm", "aria-haspopup": "dialog", onclick: () => openNewProjectDialog() },
        icon("plus"), "New project")),
    projects.length
      ? h("ul", { class: "row-list" }, projects.map((p) => {
          const done = Object.values(p.stages || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
          const meta = [plural(done, "finished report"), p.last_run_at ? `last research ${fmtAgo(p.last_run_at)}` : null].filter(Boolean).join(" · ");
          return h("li", {}, h("a", { class: "row-link", href: projectHref(p.project_id) },
            h("span", { class: "row-main" },
              h("span", { class: "row-title" }, p.name),
              h("span", { class: "row-meta" }, meta))));
        }))
      : emptyState({
          title: "No team projects yet", headingLevel: 3,
          text: "Create a project and choose this team under “Belongs to”. Everyone here then sees its finished reports and fact cards.",
        })));
  sections.push(h("section", { class: "surface form-card", "aria-labelledby": "members-h" },
    h("div", { class: "card-head" },
      h("h2", { id: "members-h" }, "Members"),
      h("span", { class: "muted" }, plural(members.length, "person", "people"))),
    h("ul", { class: "member-list" }, members.map((m) => memberRow(m, { me, canRemove: isTeamOwner, onRemove: removeMember })))));

  if (isTeamOwner) {
    const email = h("input", { type: "email", id: "invite-email", autocomplete: "off", required: true, "aria-describedby": "invite-hint" });
    const error = h("p", { class: "form-error", role: "alert" });
    const result = h("div", { class: "invite-result", role: "status" });
    const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Create invite");
    const form = h("form", { class: "stack", novalidate: true },
      h("div", { class: "control" },
        h("label", { for: "invite-email" }, "Email address"),
        h("div", { class: "input-row" }, email, submit),
        h("p", { class: "field-hint", id: "invite-hint" }, "They must sign in with this Google account. The link works for 7 days.")),
      error, result);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const value = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        error.textContent = "Enter a valid email address.";
        email.setAttribute("aria-invalid", "true");
        email.focus();
        return;
      }
      email.removeAttribute("aria-invalid");
      submit.disabled = true;
      error.textContent = "";
      try {
        const inv = await api(`${base}/invites`, { method: "POST", body: { email: value } });
        if (!isCurrent()) return;
        const link = inviteLink(inv);
        const field = h("input", { type: "text", readonly: true, class: "share-url", value: link, "aria-label": `Invite link for ${value}` });
        field.addEventListener("focus", () => field.select());
        const copyBtn = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, icon("copy"), "Copy invite link");
        copyBtn.addEventListener("click", async () => toast((await copyText(link)) ? "Invite link copied." : "Copy the link from the box."));
        result.replaceChildren(h("div", { class: "callout" },
          h("p", {}, inv.emailed
            ? [h("strong", {}, "Invite emailed "), `to ${value}. You can also share the link yourself.`]
            : [h("strong", {}, "Invite created. "), `Email is not set up here, so copy the link and send it to ${value}.`]),
          h("div", { class: "input-row" }, field, copyBtn)));
        email.value = "";
        submit.disabled = false;
        refreshInvites();
      } catch (err) {
        submit.disabled = false;
        error.textContent = friendlyError(err);
      }
    });

    const inviteList = h("div", {});
    const renderInvites = (items) => {
      inviteList.replaceChildren(items.length
        ? h("ul", { class: "member-list" }, items.map((inv) => h("li", { class: "member-row" },
            h("span", { class: "avatar avatar-initials", "aria-hidden": "true" }, "@"),
            h("div", { class: "member-main" },
              h("p", { class: "member-name" }, inv.email),
              h("p", { class: "member-meta" }, [inv.created_at ? `sent ${fmtDate(inv.created_at)}` : null, inv.expires_at ? `expires ${fmtDate(inv.expires_at)}` : null].filter(Boolean).join(" · "))),
            h("span", { class: "badge badge-neutral" }, "Pending"),
            h("div", { class: "row-actions" },
              h("button", {
                type: "button", class: "btn btn-ghost btn-sm",
                onclick: async () => toast((await copyText(inviteLink(inv))) ? "Invite link copied." : "Could not copy. Try again."),
              }, "Copy link", h("span", { class: "visually-hidden" }, ` for ${inv.email}`)),
              h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => revoke(inv) },
                "Revoke", h("span", { class: "visually-hidden" }, ` invite for ${inv.email}`))))))
        : h("p", { class: "muted" }, "No pending invites."));
    };
    async function refreshInvites() {
      try {
        const fresh = await api(base);
        if (!isCurrent()) return;
        renderInvites((fresh.invites || []).filter((i) => !i.status || i.status === "pending"));
      } catch { /* keep the current list */ }
    }
    renderInvites(invites);
    sections.push(h("section", { class: "surface form-card", "aria-labelledby": "invite-h" },
      h("h2", { id: "invite-h" }, "Invite someone"), form));
    sections.push(h("section", { class: "surface form-card", "aria-labelledby": "pending-h" },
      h("h2", { id: "pending-h" }, "Pending invites"), inviteList));
  } else {
    sections.push(h("section", { class: "surface form-card", "aria-labelledby": "leave-h" },
      h("h2", { id: "leave-h" }, "Leave the team"),
      h("p", { class: "muted" }, "Your own reports and fact cards stay in your account."),
      h("div", { class: "form-actions" }, h("button", { type: "button", class: "btn btn-danger-quiet", onclick: leave }, "Leave team"))));
  }

  sections.push(h("details", { class: "surface form-card another-team" },
    h("summary", {}, icon("chevron"), "Create another team"),
    createTeamForm(isCurrent, { idPrefix: "team2", heading: null })));

  // Several teams: a picker that keeps the choice in the address (#/team?team=<id>).
  const picker = teams.length > 1
    ? h("div", { class: "control team-picker" },
        h("label", { for: "team-select" }, "Team"),
        h("select", {
          id: "team-select",
          onchange: (ev) => go(teamHref(ev.target.value)),
        }, teams.map((t) => h("option", { value: t.team_id, selected: t.team_id === team.team_id },
          `${t.name}${t.role === "owner" ? " (owner)" : ""}`))))
    : null;

  main.replaceChildren(page(
    pageHeader({
      eyebrow: isTeamOwner ? "Team · you are the owner" : "Team · you are a member",
      title: team.name || "Team",
      lede: "Members see the team's projects: finished reports and fact cards. Conversations and reports in progress stay private.",
      extra: picker,
    }),
    h("div", { class: "team-stack" }, sections)));
}

// ---- #/join/<token> -----------------------------------------------------------

export function viewJoin(token, isCurrent, { mountSignIn }) {
  setTitle("Join a team");
  const status = h("div", { class: "join-status", role: "status" });
  const intro = h("p", { class: "lede" },
    "Someone invited you to their MarketClue team. Members share finished reports and fact cards; your conversations stay private.");
  const forWhom = h("p", { class: "muted join-for" });
  // Public preview: who invited you, to which team, and for which address (no sign-in needed).
  api(`/invites/${encodeURIComponent(token)}`, { quiet401: true }).then((inv) => {
    if (!isCurrent()) return;
    intro.textContent = `${inv.inviter_name} invited you to join ${inv.team_name} on MarketClue. ` +
      "Members share finished reports and fact cards; your conversations stay private.";
    if (inv.status === "expired") forWhom.textContent = "This invite has expired. Ask the team owner for a new link.";
    else if (inv.status !== "pending") forWhom.textContent = "This invite was already used or revoked. Ask the team owner for a new link.";
    else forWhom.textContent = `The invite is for ${inv.email_hint}.`;
  }).catch((err) => {
    if (!isCurrent()) return;
    if (err.status === 404) forWhom.textContent = "This invite link is not valid. It may be mistyped or revoked.";
  });

  if (!state.user) {
    const signin = h("div", { class: "signin" });
    main.replaceChildren(page(h("div", { class: "narrow-page" },
      pageHeader({ eyebrow: "Team invite", title: "Join your team on MarketClue" }),
      intro, forWhom,
      h("section", { class: "surface form-card stack", "aria-labelledby": "join-signin-h" },
        h("h2", { id: "join-signin-h" }, "Sign in to accept"),
        h("p", { class: "muted" }, "Use the Google account the invite was sent to. After you sign in, you come back here to join."),
        signin))));
    mountSignIn(signin, { returnTo: location.hash });
    return;
  }

  const joinBtn = h("button", { type: "button", class: "btn btn-primary" }, "Join team");
  joinBtn.addEventListener("click", async () => {
    joinBtn.disabled = true;
    status.replaceChildren(h("p", { class: "muted" }, "Joining…"));
    try {
      const data = await api("/team/join", { method: "POST", body: { token } });
      resetTeamsCache();
      refreshProjects();
      if (!isCurrent()) return;
      toast(data.team?.name ? `You joined ${data.team.name}.` : "You joined the team.");
      go(data.team?.team_id ? teamHref(data.team.team_id) : "#/team");
    } catch (err) {
      if (!isCurrent()) return;
      joinBtn.disabled = false;
      const notFound = err.status === 404;
      status.replaceChildren(h("div", { class: "callout callout-error", role: "alert" },
        h("p", {}, notFound ? "This invite link is not valid. It may be mistyped, expired or revoked." : friendlyError(err)),
        err.code === "invite_email_mismatch"
          ? h("p", {}, `You are signed in as ${state.user.email}.`)
          : null));
    }
  });
  main.replaceChildren(page(h("div", { class: "narrow-page" },
    pageHeader({ eyebrow: "Team invite", title: "Join your team on MarketClue" }),
    intro, forWhom,
    h("section", { class: "surface form-card stack", "aria-labelledby": "join-h" },
      h("h2", { id: "join-h" }, "Accept the invite"),
      h("p", { class: "muted" }, `You are signed in as ${state.user.email}. The invite must be for this address.`),
      h("div", { class: "form-actions" }, joinBtn, h("a", { class: "btn btn-ghost", href: "#/new" }, "Not now")),
      status))));
}

