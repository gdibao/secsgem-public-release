import { type FSWatcher, watch } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';

import { validateModuleAppProject } from './project';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const safeJson = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const isWithin = (root: string, target: string) =>
  target === root || target.startsWith(`${root}${path.sep}`);

const hostPage = (input: {
  displayName: string;
  entryUrl: string;
  slug: string;
}) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.displayName)} - Module App Dev</title>
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{background:#fff}</style>
<iframe id="module-app"></iframe>
<script>
const channel='comhub.module-app-sdk.v1';
const nonce=crypto.randomUUID().replaceAll('-','');
const frame=document.querySelector('#module-app');
const rows=[];
const reloadEvents=new EventSource('/__module_app_events');
reloadEvents.addEventListener('change',()=>frame.contentWindow?.location.reload());
frame.title=${safeJson(input.displayName)};
frame.src=${safeJson(input.entryUrl)}+((${safeJson(input.entryUrl)}.includes('?')?'&':'?')+'nonce='+nonce);
window.addEventListener('message',(event)=>{
  const message=event.data;
  if(event.source!==frame.contentWindow||event.origin!==location.origin||message?.channel!==channel||message?.nonce!==nonce)return;
  if(message.type==='ready'){
    frame.contentWindow.postMessage({capability:'local-development',channel,hostOrigin:location.origin,nonce,type:'launch'},location.origin);
    return;
  }
  if(message.type!=='request')return;
  let result;
  if(message.method==='context.get')result={app:{displayName:${safeJson(input.displayName)},slug:${safeJson(input.slug)}},mode:'development'};
  else if(message.method==='data.list')result={items:rows.filter((row)=>row.status==='active'&&row.tableKey===message.input?.tableKey),nextCursor:null};
  else if(message.method==='data.get')result=rows.find((row)=>row.rowKey===message.input?.rowKey&&row.tableKey===message.input?.tableKey)||null;
  else if(message.method==='data.insert'){
    result={createdAt:new Date().toISOString(),installationId:'local-development',rowKey:message.input?.rowKey||crypto.randomUUID(),status:'active',tableKey:message.input?.tableKey,updatedAt:new Date().toISOString(),values:message.input?.values||{}};
    rows.push(result);
  }else if(message.method==='data.update'){
    const row=rows.find((item)=>item.rowKey===message.input?.rowKey&&item.tableKey===message.input?.tableKey);
    if(row)Object.assign(row,{updatedAt:new Date().toISOString(),values:{...row.values,...message.input?.values}});
    result=row||null;
  }else if(message.method==='data.archive'){
    const row=rows.find((item)=>item.rowKey===message.input?.rowKey&&item.tableKey===message.input?.tableKey);
    if(row){row.status='archived';row.updatedAt=new Date().toISOString()}
    result=row||null;
  }else if(message.method==='data.transaction'){
    const staged=rows.map((row)=>({...row,values:{...row.values}}));
    const transactionResult=[];
    let transactionError;
    for(const operation of message.input?.operations||[]){
      if(operation.operation==='insert'){
        const now=new Date().toISOString();
        const row={createdAt:now,installationId:'00000000-0000-4000-8000-000000000000',rowKey:operation.rowKey||crypto.randomUUID(),status:'active',tableKey:operation.tableKey,updatedAt:now,values:operation.values||{}};
        staged.push(row);
        transactionResult.push(row);
        continue;
      }
      const row=staged.find((item)=>item.rowKey===operation.rowKey&&item.tableKey===operation.tableKey);
      if(!row){transactionError='MODULE_APP_DEV_ROW_NOT_FOUND';break}
      row.updatedAt=new Date().toISOString();
      if(operation.operation==='update')row.values={...row.values,...operation.values};
      else if(operation.operation==='archive')row.status='archived';
      else{transactionError='MODULE_APP_DEV_OPERATION_UNSUPPORTED';break}
      transactionResult.push(row);
    }
    if(transactionError){
      frame.contentWindow.postMessage({channel,error:{code:transactionError},id:message.id,nonce,ok:false,type:'response'},location.origin);
      return;
    }
    result=transactionResult;
    rows.splice(0,rows.length,...staged);
  }
  else if(message.method==='tasks.getRun')result=null;
  else if(message.method==='tasks.cancel')result={id:message.input?.runId,status:'cancelled'};
  else{
    frame.contentWindow.postMessage({channel,error:{code:'MODULE_APP_DEV_METHOD_UNSUPPORTED'},id:message.id,nonce,ok:false,type:'response'},location.origin);
    return;
  }
  frame.contentWindow.postMessage({channel,id:message.id,nonce,ok:true,result,type:'response'},location.origin);
});
</script>
</html>`;

export const startModuleAppDevServer = async (input: {
  directory: string;
  host?: string;
  port?: number;
}) => {
  const root = path.resolve(input.directory);
  const rootRealPath = await realpath(root);
  const { manifest } = await validateModuleAppProject(root);
  if (manifest.manifestVersion !== 2) throw new Error('MODULE_APP_DEV_REQUIRES_MANIFEST_V2');
  const output = path.resolve(root, manifest.build.frontend.output);
  if (!isWithin(root, output)) {
    throw new Error('MODULE_APP_BUILD_OUTPUT_INVALID');
  }
  const outputRealPath = await realpath(output);
  if (!isWithin(rootRealPath, outputRealPath)) throw new Error('MODULE_APP_BUILD_OUTPUT_INVALID');
  const outputStat = await stat(outputRealPath);
  const contentRoot = outputStat.isDirectory() ? outputRealPath : path.dirname(outputRealPath);
  const entry = outputStat.isDirectory() ? 'index.html' : path.basename(outputRealPath);
  const reloadClients = new Set<ServerResponse>();
  let reloadTimer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher;
  const notifyReload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      for (const client of reloadClients) client.write('event: change\ndata: reload\n\n');
    }, 80);
  };
  try {
    watcher = watch(contentRoot, { recursive: true }, notifyReload);
  } catch {
    watcher = watch(contentRoot, notifyReload);
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://module-app.local');
      if (url.pathname === '/__module_app_events') {
        response.writeHead(200, {
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Content-Type': 'text/event-stream',
        });
        response.write(': connected\n\n');
        reloadClients.add(response);
        request.once('close', () => reloadClients.delete(response));
        return;
      }
      if (url.pathname === '/') {
        const html = hostPage({
          displayName: manifest.app.displayName,
          entryUrl: `/__module_app_files/${encodeURIComponent(entry)}`,
          slug: manifest.app.slug,
        });
        response.writeHead(200, {
          'Content-Security-Policy':
            "default-src 'self'; frame-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(html);
        return;
      }
      if (!url.pathname.startsWith('/__module_app_files/')) {
        response.writeHead(404).end();
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice('/__module_app_files/'.length));
      const filePath = path.resolve(contentRoot, ...relative.split('/'));
      if (!isWithin(contentRoot, filePath)) {
        response.writeHead(403).end();
        return;
      }
      const fileRealPath = await realpath(filePath);
      if (!isWithin(contentRoot, fileRealPath)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(fileRealPath);
      response.writeHead(200, {
        'Content-Type':
          contentTypes[path.extname(fileRealPath).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  const host = input.host ?? '127.0.0.1';
  const port = input.port ?? 4173;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearTimeout(reloadTimer);
        watcher.close();
        for (const client of reloadClients) client.end();
        reloadClients.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: `http://${host}:${actualPort}`,
  };
};
