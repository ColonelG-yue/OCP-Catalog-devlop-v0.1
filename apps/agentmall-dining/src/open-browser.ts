import { resolve } from 'node:path';
const access=await Bun.file(resolve(import.meta.dir,'../.agentmall-state/browser-access.json')).json();
if (access.expires_at < Date.now() || new URL(access.origin).hostname!=='127.0.0.1') throw new Error('Browser access expired; restart the local server');
// Bootstrap stays local and is passed in a URL fragment, not logged or sent as a referrer.
const child=Bun.spawn(['open',`${access.origin}/#bootstrap=${encodeURIComponent(access.code)}`],{stdout:'ignore',stderr:'ignore'});
if (await child.exited!==0) throw new Error('Unable to open browser');
console.log('Opened authorized local browser');
