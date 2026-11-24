'use strict';
/* AYIFIN — Connecteur Supabase v4
   La clé "publishable/anon" est publique par conception : la sécurité repose sur le RLS de la base. */

const SUPABASE_URL = 'https://urrnnbjdoroibkixoenu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZsZ9FrSLGXZ6azZOkm2yNQ_BRss85d5';

let sb = null;      // client principal (session de l'utilisateur connecté)
let sbTmp = null;   // client secondaire (sans session) : sert à créer les comptes d'authentification

function initSupabase(){
  if(typeof window.supabase==='undefined'){ console.error('❌ SDK Supabase non chargé'); return false; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
  });
  sbTmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false, storageKey:'ayf-tmp'}
  });
  return true;
}

/* ---------- Authentification ---------- */
async function sbSignIn(email, password){
  if(!sb) throw new Error('Supabase non initialisé');
  const {data, error} = await sb.auth.signInWithPassword({email, password});
  if(error) throw error;
  return data;
}
async function sbSignOut(){ if(sb){ try{ await sb.auth.signOut(); }catch(e){} } }
async function sbGetSession(){
  if(!sb) return null;
  try{ const {data} = await sb.auth.getSession(); return data?.session || null; }catch(e){ return null; }
}
function sbOnAuth(cb){ if(sb) sb.auth.onAuthStateChange((ev, s)=>cb(ev, s)); }
async function sbResetPw(email){
  const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname});
  if(error) throw error;
}
async function sbUpdatePw(pw){
  const {error} = await sb.auth.updateUser({password: pw});
  if(error) throw error;
}
/* Crée un compte d'authentification SANS toucher à la session courante */
async function sbCreateAuthUser(email, password){
  const {data, error} = await sbTmp.auth.signUp({email, password});
  if(error) throw error;
  if(!data.user || (data.user.identities && data.user.identities.length===0)) throw new Error('Cet email est déjà utilisé.');
  try{ await sbTmp.auth.signOut({scope:'local'}); }catch(e){}
  return data.user.id;
}

/* ---------- Données ---------- */
async function sbRpc(name, args){
  const {data, error} = await sb.rpc(name, args||{});
  if(error) throw error;
  return data;
}

async function sbLoadProfile(uid){
  const {data, error} = await sb.from('users').select('*, entreprises(*)').eq('id', uid).maybeSingle();
  if(error) throw error;
  return data;
}

/* Pagination automatique (Supabase limite à 1000 lignes par requête) */
async function sbFetchAll(table, build){
  const size = 1000; let from = 0, all = [];
  for(;;){
    let q = sb.from(table).select('*');
    if(build) q = build(q);
    const {data, error} = await q.order('id').range(from, from+size-1);
    if(error) throw error;
    all = all.concat(data||[]);
    if(!data || data.length<size) break;
    from += size;
  }
  return all;
}

async function sbLoadAll(entId, isAdmin){
  const tables = ['clients','comptes','depots','retraits','transactions','prets','echeances','paiements_pret','garanties','types_compte','types_pret'];
  const res = await Promise.all(tables.map(t=>sbFetchAll(t, q=>q.eq('entreprise_id', entId))));
  const out = {};
  tables.forEach((t,i)=>out[t]=res[i]);
  const n = await sb.from('notifications').select('*').eq('entreprise_id', entId).order('created_at',{ascending:false}).limit(100);
  out.notifications = n.data || [];
  if(isAdmin){
    out.users = await sbFetchAll('users', q=>q.eq('entreprise_id', entId));
    const a = await sb.from('audit_log').select('*').eq('entreprise_id', entId).order('created_at',{ascending:false}).limit(200);
    out.audit = a.data || [];
  }
  return out;
}

async function sbLoadSuper(){
  const entreprises = await sbRpc('sa_overview');
  const users = await sbFetchAll('users');
  const a = await sb.from('audit_log').select('*').order('created_at',{ascending:false}).limit(200);
  return {entreprises: entreprises||[], users, audit: a.data||[]};
}

function sbSubscribe(entId, onChange){
  if(!sb) return null;
  try{
    const ch = sb.channel('ayifin-'+entId);
    ['clients','comptes','depots','retraits','transactions','prets','echeances','paiements_pret','garanties','notifications','users','types_compte','types_pret']
      .forEach(t=>ch.on('postgres_changes',{event:'*',schema:'public',table:t,filter:`entreprise_id=eq.${entId}`},p=>onChange(t,p)));
    ch.on('postgres_changes',{event:'*',schema:'public',table:'entreprises',filter:`id=eq.${entId}`},p=>onChange('entreprises',p));
    ch.subscribe();
    return ch;
  }catch(e){ console.warn('sbSubscribe:', e); return null; }
}

async function sbUploadPublic(bucket, path, file){
  if(file.size > 2*1024*1024) throw new Error('Image trop lourde (2 Mo maximum).');
  const {error} = await sb.storage.from(bucket).upload(path, file, {upsert:true, contentType:file.type});
  if(error) throw error;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
