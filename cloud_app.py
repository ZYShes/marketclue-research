"""Community Cloud startup validation. Paid calls remain disabled in this build."""
import hashlib
import os
from pathlib import Path
import runpy
import secrets
import subprocess
import sys
import tarfile
import time
import urllib.request
import json
import zipfile
import streamlit as st

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.cloud-runtime'
NODE_VERSION = '24.13.0'
NODE_SHA256 = 'e798599612f4bb71333a3397ab0d095fd62214e115aea45aa858a145fc72d67e'

@st.cache_resource(show_spinner=False)
def start_service():
    RUNTIME.mkdir(exist_ok=True)
    app = RUNTIME / 'app'
    with zipfile.ZipFile(ROOT / 'MarketMind-A6-deploy.zip') as bundle:
        for name in bundle.namelist():
            target = (app / name).resolve()
            if not target.is_relative_to(app.resolve()):
                raise RuntimeError('Invalid release archive path')
        bundle.extractall(app)
    node_home = RUNTIME / f'node-v{NODE_VERSION}-linux-x64'
    if not (node_home / 'bin/node').is_file():
        archive = RUNTIME / 'node.tar.xz'
        urllib.request.urlretrieve(f'https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz', archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != NODE_SHA256:
            raise RuntimeError('Node download checksum mismatch')
        with tarfile.open(archive) as bundle:
            bundle.extractall(RUNTIME, filter='data')
    env = dict(os.environ)
    env.pop('OPENAI_API_KEY', None)
    env['OPENAI_TEST_BUDGET_USD'] = '0'
    env['PATH'] = str(node_home / 'bin') + os.pathsep + env['PATH']
    backend = app / 'backend'
    (backend / 'package.json').write_bytes((backend / 'package-live.json').read_bytes())
    cli = backend / 'node_modules/n8n/bin/n8n'
    if not cli.is_file():
        with (RUNTIME / 'install.log').open('w') as log:
            subprocess.run([str(node_home / 'bin/npm'), 'install', '--omit=dev', '--no-audit', '--no-fund'], cwd=backend, env=env, stdout=log, stderr=log, timeout=1200, check=True)
    token = secrets.token_hex(32)
    env.update(MARKETMIND_GATEWAY_TOKEN=token, MARKETMIND_N8N_CLI=str(cli), MARKETMIND_PYTHON=sys.executable)
    log = (RUNTIME / 'backend.log').open('a')
    process = subprocess.Popen([str(node_home / 'bin/node'), 'live-server.mjs'], cwd=backend, env=env, stdout=log, stderr=log)
    for _ in range(300):
        if process.poll() is not None:
            raise RuntimeError('Cloud backend exited; inspect startup logs')
        try:
            with urllib.request.urlopen('http://127.0.0.1:5683/health', timeout=2) as response:
                if json.load(response).get('ready'):
                    os.environ['MARKETMIND_GATEWAY_TOKEN'] = token
                    return app, process
        except OSError:
            pass
        time.sleep(2)
    process.terminate()
    raise RuntimeError('Cloud workflow startup timed out')

with st.spinner('Preparing the cloud research workspace. First startup may take several minutes…'):
    app, process = start_service()
if process.poll() is not None:
    st.error('The cloud service stopped. Paid research is disabled in this validation build.')
    st.stop()
st.info('Cloud validation preview — paid research is disabled while hosting and durable accounting are verified. The saved example is available.')
sys.path.insert(0, str(app))
runpy.run_path(str(app / 'app.py'), run_name='__main__')
