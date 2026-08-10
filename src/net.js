import dns from 'node:dns/promises';
import net from 'node:net';

function privateIp(ip) {
  if (net.isIP(ip) === 4) {
    const p=ip.split('.').map(Number); const [a,b]=p;
    return a===10 || a===127 || a===0 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || a>=224;
  }
  if (net.isIP(ip) === 6) {
    const x=ip.toLowerCase(); return x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe8')||x.startsWith('fe9')||x.startsWith('fea')||x.startsWith('feb');
  }
  return true;
}

export async function assertSafeUrl(raw, {allowPrivate=false}={}) {
  let u; try { u=new URL(raw); } catch { const e=new Error('Invalid outbound URL'); e.code='ONCE_UNSAFE_URL'; throw e; }
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) { const e=new Error('Only credential-free HTTP(S) URLs are allowed'); e.code='ONCE_UNSAFE_URL'; throw e; }
  if (allowPrivate) return u;
  const host=u.hostname.toLowerCase();
  if (host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')) { const e=new Error('Private/internal outbound destination blocked'); e.code='ONCE_UNSAFE_URL'; throw e; }
  const ips=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true,verbatim:true});
  if (!ips.length || ips.some(x=>privateIp(x.address))) { const e=new Error('Private/reserved outbound destination blocked'); e.code='ONCE_UNSAFE_URL'; throw e; }
  return u;
}

export function safeFetcher({allowPrivate=process.env.ONCE_ALLOW_PRIVATE_NETWORK==='true'}={}) {
  return async (url, options={}) => { await assertSafeUrl(url,{allowPrivate}); return fetch(url,{...options,redirect:'error'}); };
}
