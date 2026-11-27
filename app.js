'use strict';
/* AYIFIN — Ayiti Finans — v4.1
   Corrections : types de compte/prêt + handlers robustes.
   Ajout : suppression d'entreprise + gestion automatique des contrats.
   Développé par ING. Worvensky-Wadson PIERRE */

/* ============================================================
   1. UTILITAIRES
   ============================================================ */
const T='ayf_theme';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=d=>new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);
const today=()=>iso(new Date());
const r2=n=>Math.round((+n+Number.EPSILON)*100)/100;
const SYM={HTG:'G',USD:'$',EUR:'€'};
let CUR='G';
const money=n=>r2(n||0).toLocaleString('fr-FR')+' '+CUR;
const fd=d=>{if(!d)return'';return String(d).slice(0,10).split('-').reverse().join('/')};
const fdt=d=>{if(!d)return'';const x=new Date(d);return x.toLocaleDateString('fr-FR')+' '+x.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})};
const empty=m=>`<p class="empty">${m}</p>`;
const dl=(n,t,m)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:m}));a.download=n;a.click()};
const ini=s=>String(s||'?').trim().slice(0,2).toUpperCase();
const cancel='<button type="button" class="btn alt big" data-a="closeM">Annuler</button>';

function errMsg(e){
  const m=String(e?.message||e||'');const c=e?.code||'';
  if(c==='23505'){
    if(/telephone/.test(m))return'Ce numéro de téléphone existe déjà.';
    if(/nif_cin/.test(m))return'Ce NIF/CIN existe déjà.';
    return'Cette valeur existe déjà.';
  }
  if(c==='23503')return'Suppression impossible : des données y sont liées.';
  if(c==='42501'||/row-level security|permission denied/i.test(m))return'Action non autorisée pour votre rôle, ou accès suspendu.';
  if(/Invalid login credentials/i.test(m))return'Email ou mot de passe incorrect.';
  if(/Email not confirmed/i.test(m))return'Email non confirmé : désactivez « Confirm email » dans Supabase → Authentication.';
  if(/already registered|already been registered/i.test(m))return'Cet email est déjà utilisé.';
  if(/Failed to fetch|NetworkError|network/i.test(m))return'Problème de connexion internet.';
  return m||'Erreur inconnue';
}

/* ============================================================
   2. ÉTAT GLOBAL & RÔLES
   ============================================================ */
const EMPTY=()=>({entreprise:null,user:null,blocked:null,clients:[],comptes:[],depots:[],retraits:[],transactions:[],
  prets:[],echeances:[],paiements_pret:[],garanties:[],types_compte:[],types_pret:[],notifications:[],users:[],audit:[]});
let db=EMPTY();
let SA={entreprises:[],users:[],audit:[]};
let F={q:'',pstatut:'Tous',uq:''};
let rt=null;

const role=()=>db.user?db.user.role:'';
const isSA=()=>role()==='SUPERADMIN';
const isAdmin=()=>role()==='ADMIN';
const can=(...r)=>r.includes(role());
const ROLE_LBL={SUPERADMIN:'Super Admin',ADMIN:'Administrateur',AGENT:'Agent de crédit',CAISSIER:'Caissier'};
const T3=['ADMIN','AGENT','CAISSIER'];

/* ============================================================
   3. UI
   ============================================================ */
function toast(m,err){
  const t=$('#toast');if(!t){console.log('[toast]',m);return}
  t.textContent=m;t.className=err?'err show':'show';
  clearTimeout(toast.t);toast.t=setTimeout(()=>t.className='',4200);
}
const modal=h=>{const m=$('#modal');if(!m)return;m.innerHTML=`<div class="sheet">${h}</div>`;m.hidden=false};
const closeM=()=>{const m=$('#modal');if(m){m.hidden=true;m.innerHTML=''}};

function theme(){
  try{
    const t=localStorage.getItem(T)||'auto';
    const dark=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
  }catch(e){}
}

/* ============================================================
   4. SESSION & CHARGEMENT
   ============================================================ */
function unsubscribe(){if(rt){try{sb.removeChannel(rt)}catch(e){}rt=null}}

async function loadAll(){
  if(!db.entreprise)return;
  const d=await sbLoadAll(db.entreprise.id,isAdmin());
  Object.keys(d).forEach(k=>db[k]=d[k]||[]);
}
async function loadSA(){SA=await sbLoadSuper()}
async function refresh(){
  try{
    if(!db.user||db.blocked)return;
    if(isSA())await loadSA();else if(db.entreprise)await loadAll();
  }catch(e){console.error('refresh:',e)}
}

function block(session,title,msg){
  unsubscribe();
  db=EMPTY();
  db.user={id:session.user.id,username:session.user.email,role:'NONE'};
  db.blocked={t:title,m:msg};
  render();
}

async function initSession(){
  try{
    const session=await sbGetSession();
    if(!session){unsubscribe();db=EMPTY();render();return}
    let profile=null;
    try{profile=await sbLoadProfile(session.user.id)}catch(err){console.error('profil:',err)}
    if(!profile)return block(session,'Profil introuvable','Votre compte est authentifié mais n\'a pas de profil AYIFIN. Contactez votre administrateur.');
    if(!profile.actif)return block(session,'Compte désactivé','Votre compte utilisateur a été désactivé. Contactez votre administrateur.');

    if(profile.role==='SUPERADMIN'){
      unsubscribe();CUR='G';
      db=EMPTY();db.user=profile;
      await loadSA();
      render();return;
    }
    const ent=profile.entreprises;
    if(!ent)return block(session,'Entreprise introuvable','Aucune entreprise n\'est liée à votre compte.');
    if(!ent.actif)return block(session,'Accès suspendu','L\'accès de « '+ent.nom+' » à AYIFIN est suspendu. Contactez le support AYIFIN.');
    if(ent.date_contrat_fin&&ent.date_contrat_fin<today())return block(session,'Contrat expiré','Le contrat de « '+ent.nom+' » a expiré le '+fd(ent.date_contrat_fin)+'. Contactez le support AYIFIN.');

    db=EMPTY();db.user=profile;db.entreprise=ent;CUR=SYM[ent.devise]||'G';
    try{await sbRpc('rpc_maj_retards')}catch(e){console.warn('retards:',e)}
    await loadAll();
    subscribeRealtime();
    render();
  }catch(err){
    console.error('initSession:',err);
    toast('Erreur d\'initialisation : '+errMsg(err),1);
    render();
  }
}

function scheduleReload(){
  clearTimeout(scheduleReload.t);
  scheduleReload.t=setTimeout(async()=>{
    if(!db.entreprise||db.blocked)return;
    try{await loadAll()}catch(e){return}
    const m=$('#modal'),ae=document.activeElement;
    const typing=ae&&/^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)&&ae.closest('#app');
    if((m&&!m.hidden)||typing)return;
    render();
  },500);
}
function subscribeRealtime(){
  unsubscribe();
  if(!db.entreprise)return;
  rt=sbSubscribe(db.entreprise.id,(t,p)=>{
    if(t==='entreprises'||(t==='users'&&p.new&&p.new.id===db.user.id)){initSession();return}
    if(t==='notifications'&&p.eventType==='INSERT'&&p.new)toast('🔔 '+p.new.message);
    scheduleReload();
  });
}

/* ============================================================
   5. CALCULS
   ============================================================ */
function globalStats(){
  const {prets,echeances:echs,comptes,depots,retraits,paiements_pret:pays}=db;
  const sum=(a,k)=>r2(a.reduce((s,x)=>s+(+x[k]||0),0));
  const actifs=prets.filter(p=>['EN_COURS','RETARD'].includes(p.statut));
  const decs=prets.filter(p=>['EN_COURS','RETARD','REMBOURSE'].includes(p.statut));
  const dep=sum(depots,'montant'),ret=sum(retraits,'montant'),rem=sum(pays,'montant');
  const decaisse=r2(decs.reduce((s,p)=>s+(+p.montant||0)-(+p.frais_dossier||0),0));
  const fraisCompte=r2(db.transactions.filter(x=>x.type_transaction==='FRAIS').reduce((s,x)=>s-(+x.montant||0),0));
  const fraisDossier=sum(decs,'frais_dossier');
  const encours=sum(actifs,'solde_restant');
  const retardEnc=sum(prets.filter(p=>p.statut==='RETARD'),'solde_restant');
  return{
    clients:db.clients.length,comptes:comptes.length,prets_actifs:actifs.length,
    demandes:prets.filter(p=>p.statut==='DEMANDE').length,
    alertes:echs.filter(e=>['EN_ATTENTE','RETARD'].includes(e.statut)&&e.date_echeance<today()).length,
    solde_total:sum(comptes,'solde'),encours_prets:encours,depots_total:dep,retraits_total:ret,
    caisse:r2(dep-ret-decaisse+rem),decaissements_total:decaisse,remboursements_total:rem,
    interets_gagnes:sum(pays,'interet_paye'),frais_percus:r2(fraisCompte+fraisDossier),
    par:encours>0?r2(retardEnc/encours*100):0
  };
}
const clientById=id=>db.clients.find(c=>c.id===id);
const compteById=id=>db.comptes.find(c=>c.id===id);
const typeCompteById=id=>db.types_compte.find(t=>t.id===id);
const typePretById=id=>db.types_pret.find(t=>t.id===id);
const pretById=id=>db.prets.find(p=>p.id===id);
const simul=(c,tm,d)=>{const i=r2(c*tm/100*d),t=r2(c+i);return{int:i,tot:t,mens:r2(t/d)}};
const daysLate=e=>Math.floor((new Date()-new Date(e.date_echeance+'T12:00:00'))/864e5);
const unread=()=>db.notifications.filter(n=>!n.lu).length;

/* ============================================================
   6. ICÔNES & NAVIGATION
   ============================================================ */
const I={
  home:'M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z',
  users:'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8zM21 21v-2a4 4 0 00-3-3.9',
  card:'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l14-3v3M16 14h2',
  plus:'M12 5v14M5 12h14',
  money:'M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6',
  clock:'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  chart:'M4 20V10M10 20V4M16 20v-8M22 20H2',
  gear:'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12h2M3 12h2M12 3v2M12 19v2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  bell:'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  building:'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  shield:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'
};
const ico=n=>`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${I[n]||''}"/></svg>`;
const ALL=['SUPERADMIN','ADMIN','AGENT','CAISSIER'];
const NAV_ALL=[
  ['dashboard','Accueil','home',ALL],
  ['clients','Clients','users',T3],
  ['comptes','Comptes','card',T3],
  ['operations','Opérations','plus',T3],
  ['prets','Prêts','money',T3],
  ['echeances','Échéances','clock',T3],
  ['rapports','Rapports','chart',['ADMIN','AGENT']],
  ['notifications','Alertes','bell',T3],
  ['entreprises','Entreprises','building',['SUPERADMIN']],
  ['utilisateurs','Utilisateurs','shield',['SUPERADMIN','ADMIN']],
  ['journal','Journal','list',['SUPERADMIN','ADMIN']],
  ['settings','Réglages','gear',ALL]
];
const ACCESS={dashboard:ALL,clients:T3,client:T3,comptes:T3,compte:T3,operations:T3,prets:T3,pret:T3,echeances:T3,
  rapports:['ADMIN','AGENT'],notifications:T3,utilisateurs:['SUPERADMIN','ADMIN'],journal:['SUPERADMIN','ADMIN'],
  settings:ALL,entreprises:['SUPERADMIN'],entreprise:['SUPERADMIN']};
const navFor=()=>NAV_ALL.filter(n=>n[3].includes(role()));

/* ============================================================
   7. COMPOSANTS
   ============================================================ */
const clientOpts=(pre='')=>`<option value="">— Choisir —</option>`+
  db.clients.slice().sort((a,b)=>String(a.nom_complet||'').localeCompare(String(b.nom_complet||'')))
    .map(c=>`<option value="${esc(c.id)}" ${c.id===pre?'selected':''}>${esc(c.nom_complet)}</option>`).join('');
const compteOptsFor=(clientId,pre='')=>`<option value="">— Choisir —</option>`+
  db.comptes.filter(c=>c.statut==='ACTIF'&&(!clientId||clientId==='__none__'?true:c.client_id===clientId)).map(c=>{
    const cl=clientById(c.client_id);
    return`<option value="${esc(c.id)}" ${c.id===pre?'selected':''}>${esc(c.numero_compte_interne||'')} — ${esc(cl?cl.nom_complet:'?')}</option>`}).join('');
const typeCompteOpts=()=>db.types_compte.filter(t=>t.actif).map(t=>`<option value="${t.id}">${esc(t.nom)} — min ${money(t.depot_min)}, frais ${money(t.frais_ouv)}</option>`).join('');
const typePretOpts=()=>`<option value="">— Choisir —</option>`+db.types_pret.filter(t=>t.actif).map(t=>`<option value="${t.id}">${esc(t.nom)} (${t.taux_mensuel}%/mois, max ${t.duree_max} mois)</option>`).join('');
const roleOpts=(pre)=>['ADMIN','AGENT','CAISSIER'].map(r=>`<option value="${r}" ${pre===r?'selected':''}>${ROLE_LBL[r]}</option>`).join('');
const statutBadge=s=>{
  const map={ACTIF:'green',SUSPENDU:'or',FERME:'red',EN_COURS:'blue',RETARD:'red',REMBOURSE:'green',DEMANDE:'or',APPROUVE:'blue',REJETE:'red',PAYE:'green',EN_ATTENTE:'or',ANNULE:'red',EXPIRE:'red'};
  const k=String(s||'');return `<span class="badge ${map[k]||''}">${esc(k)}</span>`;
};
const logo=(e,s=36)=>e&&e.logo_url
  ?`<img src="${esc(e.logo_url)}" alt="logo" class="ava sq" style="width:${s}px;height:${s}px">`
  :`<div class="ava sq" style="width:${s}px;height:${s}px;font-size:${Math.round(s*.4)}px">${esc(ini(e&&e.nom||'AY'))}</div>`;
const avatar=(u,s=40)=>u&&u.avatar_url
  ?`<img src="${esc(u.avatar_url)}" alt="" class="ava" style="width:${s}px;height:${s}px">`
  :`<div class="ava" style="width:${s}px;height:${s}px;font-size:${Math.round(s*.38)}px">${esc(ini(u&&(u.nom_complet||u.username)))}</div>`;
const pretRow=p=>{const cl=clientById(p.client_id);
  return `<a class="row" href="#/pret/${esc(p.id)}"><div><b>${esc(p.numero_pret||'')}</b>${statutBadge(p.statut)}<small>${esc(cl?cl.nom_complet:'?')} · ${fd(p.date_debut)} → ${fd(p.date_fin)}</small></div><div class="amt">${money(p.montant)}<small>reste ${money(p.solde_restant)}</small></div></a>`};
const card=(l,v,c)=>`<div class="card"><small>${l}</small><b class="n ${c||''}">${v}</b></div>`;

/* ============================================================
   8. VUES
   ============================================================ */
const V={};

const loginV=()=>`
<div class="auth">
  <h1>AYIFIN</h1>
  <p>Ayiti Finans — Gestion de microfinance</p>
  <form id="flogin" class="form">
    <label>Email<input name="email" type="email" required autocomplete="username"></label>
    <label>Mot de passe<input name="pw" type="password" required autocomplete="current-password"></label>
    <button class="btn big" type="submit">Se connecter</button>
    <button class="link" type="button" data-a="forgot">Mot de passe oublié ?</button>
  </form>
  <small style="margin-top:20px;text-align:center">Accès réservé aux utilisateurs enregistrés.<br>Développé par ING. Worvensky-Wadson PIERRE</small>
</div>`;

const blockedV=()=>`
<div class="auth">
  <h1>AYIFIN</h1>
  <div class="alert danger" style="margin-top:20px"><b>${esc(db.blocked.t)}</b><br>${esc(db.blocked.m)}</div>
  <button class="btn big" data-a="logout">Se déconnecter</button>
</div>`;

/* ---------- Tableau de bord ---------- */
const tDash=()=>{
  const s=globalStats();
  const alertes=db.echeances.filter(e=>['EN_ATTENTE','RETARD'].includes(e.statut)&&e.date_echeance<today())
    .sort((a,b)=>a.date_echeance.localeCompare(b.date_echeance)).slice(0,5).map(e=>{
    const p=pretById(e.pret_id);const cl=p?clientById(p.client_id):null;const jr=daysLate(e);
    return `<div class="alert ${jr>30?'danger':'warning'}"><b>${esc(cl?cl.nom_complet:'?')}</b> — Échéance #${e.numero_echeance} en retard de ${jr} jour(s) (${money(e.montant_echeance)})</div>`;
  }).join('');
  const pend=isAdmin()?db.prets.filter(p=>p.statut==='DEMANDE'):[];
  const cn=T3.includes(role());
  return `<div class="grid">
    ${card('Clients',s.clients)}${card('Comptes',s.comptes)}${card('Prêts actifs',s.prets_actifs)}
    ${card('Demandes en attente',s.demandes,'or')}${card('Épargne clients',money(s.solde_total),'green')}
    ${card('Caisse',money(s.caisse),s.caisse>=0?'green':'red')}
    ${card('Encours prêts',money(s.encours_prets),'red')}${card('Décaissements',money(s.decaissements_total),'red')}
    ${card('Remboursements',money(s.remboursements_total),'green')}${card('Intérêts gagnés',money(s.interets_gagnes),'green')}
    ${card('Dépôts',money(s.depots_total),'green')}${card('Retraits',money(s.retraits_total),'red')}
    <div class="card net"><small>Échéances en retard</small><b class="n">${s.alertes}</b></div>
  </div>
  ${pend.length?`<h2>📝 Prêts à approuver (${pend.length})</h2>${pend.slice(0,5).map(pretRow).join('')}`:''}
  ${alertes?`<h2>⚠️ Alertes de retard</h2>${alertes}`:''}
  ${cn?`<div class="acts">
    ${can('ADMIN','AGENT')?'<a class="btn" href="#/clients">+ Client</a><a class="btn alt" href="#/prets">+ Prêt</a>':''}
    <a class="btn alt" href="#/operations">Opération</a>
    ${can('ADMIN','AGENT')?'<a class="btn alt" href="#/rapports">Rapports</a>':''}
  </div>`:''}
  <h2>Derniers prêts</h2>
  ${[...db.prets].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,5).map(pretRow).join('')||empty('Aucun prêt')}`;
};

const entRow=e=>{
  const exp=e.date_contrat_fin&&e.date_contrat_fin<today();
  return `<a class="row" href="#/entreprise/${esc(e.id)}"><div class="who">${logo(e,40)}<div><b>${esc(e.nom)}</b>${statutBadge(e.actif?'ACTIF':'SUSPENDU')}${exp?statutBadge('EXPIRE'):''}<small>${e.nb_users_actifs}/${e.max_users} utilisateurs · ${e.nb_clients} clients · ${e.nb_prets} prêts actifs</small></div></div><div class="amt">${money(e.epargne)}<small>épargne</small></div></a>`;
};

const saDash=()=>{
  const E=SA.entreprises,n=k=>E.reduce((s,e)=>s+(+e[k]||0),0);
  const lim=iso(new Date(Date.now()+30*864e5));
  const al=E.filter(e=>e.date_contrat_fin&&e.date_contrat_fin<=lim).map(e=>{
    const exp=e.date_contrat_fin<today();
    const jours=Math.ceil((new Date(e.date_contrat_fin)-new Date(today()))/864e5);
    return `<a class="alert ${exp?'danger':'warning'}" style="display:block" href="#/entreprise/${esc(e.id)}"><b>${esc(e.nom)}</b> — contrat ${exp?'expiré le':'expire le'} ${fd(e.date_contrat_fin)} ${!exp?`(J-${jours})`:''}</a>`}).join('');
  return `<div class="grid">
    ${card('Entreprises',E.length)}${card('Actives',E.filter(e=>e.actif).length,'green')}${card('Suspendues',E.filter(e=>!e.actif).length,'red')}
    ${card('Utilisateurs',n('nb_users'))}${card('Clients',n('nb_clients'))}${card('Comptes',n('nb_comptes'))}
    ${card('Épargne totale',money(n('epargne')),'green')}${card('Encours prêts',money(n('encours')),'red')}
  </div>
  ${al?`<h2>⚠️ Contrats à surveiller</h2>${al}`:''}
  <div class="acts">
    <button class="btn" data-a="entnew">+ Nouvelle entreprise</button>
    <button class="btn alt" data-a="contratsalertes">🔔 Alertes contrats</button>
    <button class="btn alt" data-a="suspendexpired">⏸ Suspendre les expirés</button>
  </div>
  <h2>Entreprises</h2>${E.map(entRow).join('')||empty('Aucune entreprise. Créez la première.')}`;
};
V.dashboard=()=>isSA()?saDash():tDash();

/* ---------- Clients ---------- */
const clist=()=>{
  const q=(F.q||'').toLowerCase();
  const list=db.clients.filter(c=>!q||String(c.nom_complet||'').toLowerCase().includes(q)||String(c.nif_cin||'').toLowerCase().includes(q)||String(c.telephone||'').includes(q))
    .sort((a,b)=>String(a.nom_complet||'').localeCompare(String(b.nom_complet||'')));
  return list.map(c=>{
    const cs=db.comptes.filter(x=>x.client_id===c.id);
    const solde=r2(cs.reduce((s,x)=>s+(+x.solde||0),0));
    return `<a class="row" href="#/client/${esc(c.id)}"><div><b>${esc(c.nom_complet)}</b><small>${esc(c.nif_cin||'')} · ${esc(c.telephone||'')}</small></div><div class="amt"><b>${money(solde)}</b><small>${cs.length} compte(s)</small></div></a>`;
  }).join('')||empty('Aucun client');
};
V.clients=()=>`<div class="bar"><input id="q" data-f="q" placeholder="Rechercher…" value="${esc(F.q||'')}">${can('ADMIN','AGENT')?'<button class="btn" data-a="cform">+ Client</button>':''}</div><div id="clist">${clist()}</div>`;

V.client=id=>{
  const c=clientById(id);if(!c)return empty('Client introuvable');
  const cs=db.comptes.filter(x=>x.client_id===id),prets=db.prets.filter(p=>p.client_id===id);
  return `<div class="card"><h2 style="margin:0">${esc(c.nom_complet)}</h2>
    <small>NIF/CIN : ${esc(c.nif_cin||'')} · Tél : ${esc(c.telephone||'')}</small>
    <small>${esc(c.adresse||'')}${c.ville?', '+esc(c.ville):''}${c.profession?' · '+esc(c.profession):''}</small>
    <div class="acts">${can('ADMIN','AGENT')?`<button class="btn" data-a="cform" data-id="${esc(id)}">Modifier</button>`:''}${isAdmin()?`<button class="btn del" data-a="delc" data-id="${esc(id)}">Supprimer</button>`:''}</div></div>
  <h2>Comptes (${cs.length})</h2>
  ${cs.map(cp=>{const t=typeCompteById(cp.type_compte_id);return`<a class="row" href="#/compte/${esc(cp.id)}"><div><b>${esc(cp.numero_compte_interne||'')}</b>${statutBadge(cp.statut)}<small>${esc(t?t.nom:'?')}</small></div><div class="amt green">${money(cp.solde)}</div></a>`}).join('')||empty('Aucun compte')}
  <button class="btn big" data-a="ccompte" data-id="${esc(id)}">+ Ouvrir un compte</button>
  <h2>Prêts (${prets.length})</h2>${prets.map(pretRow).join('')||empty('Aucun prêt')}`;
};

/* ---------- Comptes ---------- */
V.comptes=()=>{
  const list=[...db.comptes].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  return `<div class="bar"><button class="btn" data-a="ccompte">+ Ouvrir un compte</button></div>
  ${list.map(cp=>{const cl=clientById(cp.client_id),t=typeCompteById(cp.type_compte_id);return`<a class="row" href="#/compte/${esc(cp.id)}"><div><b>${esc(cp.numero_compte_interne||'')}</b>${statutBadge(cp.statut)}<small>${esc(cl?cl.nom_complet:'?')} · ${esc(t?t.nom:'?')}</small></div><div class="amt green">${money(cp.solde)}</div></a>`}).join('')||empty('Aucun compte')}`;
};
V.compte=id=>{
  const cp=compteById(id);if(!cp)return empty('Compte introuvable');
  const cl=clientById(cp.client_id),t=typeCompteById(cp.type_compte_id);
  const dep=db.depots.filter(d=>d.compte_id===id),ret=db.retraits.filter(d=>d.compte_id===id);
  const trx=db.transactions.filter(x=>x.compte_id===id).sort((a,b)=>String(b.date_transaction||'').localeCompare(String(a.date_transaction||''))).slice(0,30);
  const act=cp.statut==='ACTIF';
  return `<div class="card"><h2 style="margin:0">${esc(cp.numero_compte_interne||'')}</h2>${statutBadge(cp.statut)}
    <small>${esc(cl?cl.nom_complet:'?')} · ${esc(t?t.nom:'?')}</small>
    <div class="kpi">${card('Solde',money(cp.solde),'green')}${card('Taux',t?t.taux+'%':'—')}${card('Dépôts',dep.length)}${card('Retraits',ret.length)}</div>
    ${act?`<div class="acts"><button class="btn" data-a="cdepot" data-id="${esc(id)}">+ Dépôt</button><button class="btn alt" data-a="cretrait" data-id="${esc(id)}">− Retrait</button>${can('ADMIN','AGENT')?`<button class="btn alt" data-a="ccloture" data-id="${esc(id)}">Clôturer</button>`:''}</div>`:''}</div>
    <h2>Dernières transactions</h2>
    ${trx.map(x=>`<div class="row"><div><b>${esc(x.type_transaction||'')}</b><small>${fd(x.date_transaction)} · ${esc(x.description||'')}</small></div><div class="amt ${(x.montant||0)<0?'red':'green'}">${money(x.montant)}</div></div>`).join('')||empty('Aucune transaction')}`;
};

/* ---------- Opérations ---------- */
V.operations=()=>{
  const ops=[...db.depots.map(d=>({k:'D',...d})),...db.retraits.map(d=>({k:'R',...d}))].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  return `<div class="card form"><b>Nouvelle opération</b>
    <form id="fop" class="form">
      <label>Compte<select name="compte_id" required>${compteOptsFor('')}</select></label>
      <div class="seg">
        <label><input type="radio" name="type_op" value="DEPOT" checked><span>DÉPÔT</span></label>
        <label><input type="radio" name="type_op" value="RETRAIT"><span>RETRAIT</span></label>
      </div>
      <label>Montant<input name="montant" type="number" step="0.01" min="0.01" required></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Description<input name="description"></label>
      <button class="btn big">VALIDER L'OPÉRATION</button>
    </form></div>
  <h2>Dernières opérations</h2>
  ${ops.slice(0,30).map(o=>{const cp=compteById(o.compte_id);const cl=cp?clientById(cp.client_id):null;
    return`<div class="row"><div><b>${o.k==='D'?'Dépôt':'Retrait'}</b><small>${esc(cl?cl.nom_complet:'?')} · ${fd(o.date_operation)} ${o.description?'· '+esc(o.description):''}</small></div><div class="amt ${o.k==='D'?'green':'red'}">${o.k==='D'?'+':'-'}${money(o.montant)}</div></div>`}).join('')||empty('Aucune opération')}`;
};

/* ---------- Prêts ---------- */
V.prets=()=>{
  const statuts=['Tous','DEMANDE','EN_COURS','RETARD','REMBOURSE','REJETE'];
  const filtre=F.pstatut||'Tous';
  const list=db.prets.filter(p=>filtre==='Tous'||p.statut===filtre).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  return `<div class="card"><div class="seg" style="flex-wrap:wrap">${statuts.map(s=>`<label style="flex:0 0 auto;min-width:80px"><input type="radio" name="pstatut" data-f="pstatut" value="${s}" ${filtre===s?'checked':''}><span>${s}</span></label>`).join('')}</div></div>
  ${can('ADMIN','AGENT')?'<div class="bar"><button class="btn" data-a="cpret">+ Nouveau prêt</button></div>':''}
  ${list.map(pretRow).join('')||empty('Aucun prêt')}`;
};
V.pret=id=>{
  const p=pretById(id);if(!p)return empty('Prêt introuvable');
  const cl=clientById(p.client_id),tp=typePretById(p.type_pret_id);
  const echs=db.echeances.filter(e=>e.pret_id===id).sort((a,b)=>a.numero_echeance-b.numero_echeance);
  const pays=db.paiements_pret.filter(x=>x.pret_id===id).sort((a,b)=>String(b.date_paiement||'').localeCompare(String(a.date_paiement||'')));
  const totalPaye=r2(pays.reduce((s,x)=>s+(+x.montant||0),0));
  let actions='';
  if(p.statut==='DEMANDE'){
    actions=isAdmin()
      ?`<button class="btn" data-a="apret" data-id="${esc(id)}">Approuver & décaisser</button><button class="btn del" data-a="rpret" data-id="${esc(id)}">Rejeter</button>`
      :`<small>⏳ En attente d'approbation par l'administrateur de l'entreprise.</small>`;
  }else if(['EN_COURS','RETARD'].includes(p.statut)){
    actions=`<button class="btn" data-a="ppay" data-id="${esc(id)}">+ Paiement</button>`;
  }
  return `<div class="card"><h2 style="margin:0">${esc(p.numero_pret||'')}</h2>${statutBadge(p.statut)}
    <small>${esc(cl?cl.nom_complet:'?')} · ${esc(tp?tp.nom:'?')} · ${p.taux_interet_mensuel}%/mois · ${p.duree_mois} mois</small>
    ${p.statut==='REJETE'&&p.motif_rejet?`<small>Motif du rejet : ${esc(p.motif_rejet)}</small>`:''}
    <div class="kpi">
      ${card('Montant',money(p.montant))}${card('Intérêt',money(p.montant_interet))}${card('Total dû',money(p.montant_total))}
      ${card('Mensualité',money(p.mensualite))}${card('Frais de dossier',money(p.frais_dossier))}${card('Payé',money(totalPaye),'green')}
      ${card('Reste',money(p.solde_restant),'red')}
    </div>
    <div class="acts">${actions}</div></div>
  <h2>Échéancier (${echs.length})</h2>
  <div class="card">${echs.map(e=>`<div class="echeance"><span>#${e.numero_echeance} — ${fd(e.date_echeance)}</span><span class="amt">${money(e.montant_echeance)}</span><span class="statut ${e.statut}">${e.statut}</span></div>`).join('')||empty('Aucune échéance')}</div>
  <h2>Paiements (${pays.length})</h2>
  ${pays.map(x=>`<div class="row"><div><b>${fd(x.date_paiement)}</b><small>Capital ${money(x.capital_rembourse)} · Intérêt ${money(x.interet_paye)}</small></div><div class="amt green">${money(x.montant)}</div></div>`).join('')||empty('Aucun paiement')}`;
};

/* ---------- Échéances ---------- */
V.echeances=()=>{
  const td=today();
  const list=db.echeances.filter(e=>['EN_ATTENTE','RETARD'].includes(e.statut)).sort((a,b)=>String(a.date_echeance).localeCompare(String(b.date_echeance)));
  const enRetard=list.filter(e=>e.date_echeance<td);
  const lim=iso(new Date(Date.now()+7*864e5));
  const proches=list.filter(e=>e.date_echeance>=td&&e.date_echeance<=lim);
  const row=e=>{const p=pretById(e.pret_id);const cl=p?clientById(p.client_id):null;const jr=daysLate(e);
    return`<a class="row" href="#/pret/${esc(e.pret_id)}"><div><b>${esc(cl?cl.nom_complet:'?')}</b><small>${esc(p?p.numero_pret:'?')} · #${e.numero_echeance} · ${fd(e.date_echeance)}</small></div><div class="amt ${jr>0?'red':''}">${money(e.montant_echeance)}<small>${jr>0?jr+' j de retard':''}</small></div></a>`};
  return `<h2>En retard (${enRetard.length})</h2>${enRetard.map(row).join('')||empty('Aucune')}
  <h2>7 prochains jours (${proches.length})</h2>${proches.map(row).join('')||empty('Aucune')}
  <h2>À venir (${list.length})</h2>${list.slice(0,50).map(row).join('')||empty('Aucune')}`;
};

/* ---------- Rapports ---------- */
V.rapports=()=>{
  const s=globalStats();
  const par={};db.prets.forEach(p=>{const k=String(p.statut||'?');par[k]=(par[k]||0)+1});
  const tot=Math.max(1,db.prets.length);
  return `<h2>Statistiques générales</h2>
  <div class="kpi">
    ${card('Clients',s.clients)}${card('Comptes',s.comptes)}${card('Épargne clients',money(s.solde_total),'green')}
    ${card('Caisse',money(s.caisse),s.caisse>=0?'green':'red')}${card('Encours prêts',money(s.encours_prets),'red')}
    ${card('Intérêts gagnés',money(s.interets_gagnes),'green')}${card('Frais perçus',money(s.frais_percus),'green')}
    ${card('Portefeuille à risque',s.par+' %',s.par>5?'red':'green')}
  </div>
  <h2>Prêts par statut</h2>
  <div class="card">${Object.entries(par).map(([k,v])=>`<div class="stat-row"><span class="k">${statutBadge(k)}</span><span class="v">${v} (${Math.round(v/tot*100)}%)</span></div>`).join('')||empty('Aucun prêt')}</div>
  <div class="acts"><button class="btn" data-a="csv">Exporter CSV</button><button class="btn alt" data-a="print">Imprimer</button></div>`;
};

/* ---------- Alertes ---------- */
V.notifications=()=>{
  const list=[...db.notifications].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const un=list.filter(n=>!n.lu).length;
  return `<div class="bar"><b style="flex:1;align-self:center">${un} non lue(s)</b>${un?'<button class="btn alt" data-a="nreadall">Tout marquer comme lu</button>':''}</div>`+
  (list.map(n=>`<div class="row notif ${n.lu?'':'unread'}"><div><b>${esc(n.auteur_nom||'Système')}</b><small style="color:var(--tx)">${esc(n.message)}</small><small>${fdt(n.created_at)}</small></div>${n.lu?'':`<button class="btn alt" data-a="nread" data-id="${esc(n.id)}">Lu</button>`}</div>`).join('')||empty('Aucune alerte'));
};

/* ---------- Utilisateurs ---------- */
const userRow=(u,showEnt)=>{
  const ent=showEnt?SA.entreprises.find(x=>x.id===u.entreprise_id):null;
  const me=u.id===db.user.id;
  return `<div class="row wrap"><div class="who">${avatar(u)}<div><b>${esc(u.nom_complet||u.username)}</b>${me?'<span class="badge blue">VOUS</span>':''}<span class="badge">${esc(ROLE_LBL[u.role]||u.role)}</span>${statutBadge(u.actif?'ACTIF':'SUSPENDU')}<small>${esc(u.email||u.username)}${ent?' · '+esc(ent.nom):''}${u.telephone?' · '+esc(u.telephone):''}</small></div></div>
  ${me||u.role==='SUPERADMIN'?'':`<div class="acts" style="margin:0"><button class="btn alt" data-a="uedit" data-id="${esc(u.id)}">Modifier</button><button class="btn ${u.actif?'del':''}" data-a="utoggle" data-id="${esc(u.id)}">${u.actif?'Désactiver':'Activer'}</button></div>`}</div>`;
};
const ulist=()=>{
  const q=(F.uq||'').toLowerCase();
  return (isSA()?SA.users:db.users).filter(u=>!q||[u.nom_complet,u.username,u.email].some(v=>String(v||'').toLowerCase().includes(q)))
    .map(u=>userRow(u,isSA())).join('')||empty('Aucun utilisateur');
};
V.utilisateurs=()=>{
  const head=isAdmin()
    ?`<div class="bar"><b style="flex:1;align-self:center">${db.users.filter(u=>u.actif).length} / ${db.entreprise.max_users} utilisateurs actifs</b><button class="btn" data-a="unew" data-id="${esc(db.entreprise.id)}">+ Utilisateur</button></div>`
    :`<div class="bar"><input data-f="uq" placeholder="Rechercher un utilisateur…" value="${esc(F.uq||'')}"></div>`;
  return head+`<div id="ulist">${ulist()}</div>`;
};

/* ---------- Journal ---------- */
V.journal=()=>{
  const src=isSA()?SA.audit:db.audit;
  return `<small style="margin-bottom:10px">Les 200 dernières actions enregistrées</small>`+
  (src.map(a=>{
    const ent=isSA()?SA.entreprises.find(x=>x.id===a.entreprise_id):null;
    return `<div class="row"><div><b>${esc(a.username||'Système')}</b>${ent?`<span class="badge">${esc(ent.nom)}</span>`:''}<small style="color:var(--tx)">${esc(a.details||a.action)}</small><small>${fdt(a.created_at)}</small></div></div>`}).join('')||empty('Journal vide'));
};

/* ---------- Réglages ---------- */
V.settings=()=>{
  const u=db.user,e=db.entreprise;
  const ent=e?`<div class="card"><div class="who">${logo(e,48)}<div><b>${esc(e.nom)}</b><small>${esc(e.slogan||'')}</small></div></div>
    <small>${esc(e.adresse||'')} ${e.telephone?'· '+esc(e.telephone):''}</small>
    <small>Plan ${esc(e.plan)} · Devise ${esc(e.devise)} · Contrat jusqu'au ${e.date_contrat_fin?fd(e.date_contrat_fin):'illimité'}</small>
    ${isAdmin()?'<div class="acts"><button class="btn" data-a="cent">Configurer l\'entreprise</button></div>':''}</div>`:'';
  const prod=isAdmin()?`<h2>Produits d'épargne</h2>
    ${db.types_compte.map(t=>`<div class="row"><div><b>${esc(t.nom)}</b>${statutBadge(t.actif?'ACTIF':'SUSPENDU')}<small>Taux ${t.taux}% · Dépôt min ${money(t.depot_min)} · Frais ${money(t.frais_ouv)}</small></div><button class="btn alt" data-a="tcform" data-id="${t.id}">Modifier</button></div>`).join('')||empty('Aucun')}
    <div class="acts"><button class="btn" data-a="tcform">+ Type de compte</button></div>
    <h2>Produits de prêt</h2>
    ${db.types_pret.map(t=>`<div class="row"><div><b>${esc(t.nom)}</b>${statutBadge(t.actif?'ACTIF':'SUSPENDU')}<small>${t.taux_mensuel}%/mois · ${t.duree_max} mois max · ${money(t.montant_min)}–${money(t.montant_max)} · dossier ${money(t.frais)}</small></div><button class="btn alt" data-a="tpform" data-id="${t.id}">Modifier</button></div>`).join('')||empty('Aucun')}
    <div class="acts"><button class="btn" data-a="tpform">+ Type de prêt</button></div>`:'';
  return `<div class="card"><div class="who">${avatar(u,52)}<div><b>${esc(u.nom_complet||u.username)}</b><span class="badge">${esc(ROLE_LBL[u.role]||u.role)}</span><small>${esc(u.email||u.username)}</small></div></div>
    <div class="acts"><button class="btn" data-a="profil">Mon profil</button><button class="btn alt" data-a="chpw">Changer le mot de passe</button><button class="btn alt" data-a="logout">Se déconnecter</button></div></div>
  ${ent}
  <div class="card form"><label>Thème<select data-f="theme">${[['auto','Automatique'],['light','Clair'],['dark','Sombre']].map(([v,l])=>`<option value="${v}" ${(localStorage.getItem(T)||'auto')===v?'selected':''}>${l}</option>`).join('')}</select></label></div>
  ${prod}
  ${can('ADMIN','AGENT')?'<div class="acts"><button class="btn alt" data-a="csv">Exporter CSV</button></div>':''}
  <small style="text-align:center;margin-top:20px">AYIFIN v4.1 — Développé par ING. Worvensky-Wadson PIERRE</small>`;
};

/* ---------- Super Admin : entreprises ---------- */
const elist=()=>{
  const q=(F.q||'').toLowerCase();
  return SA.entreprises.filter(e=>!q||String(e.nom||'').toLowerCase().includes(q)).map(entRow).join('')||empty('Aucune entreprise');
};
V.entreprises=()=>`<div class="bar"><input id="eq" data-f="q" placeholder="Rechercher une entreprise…" value="${esc(F.q||'')}"><button class="btn" data-a="entnew">+ Entreprise</button></div><div id="elist">${elist()}</div>`;

V.entreprise=id=>{
  const e=SA.entreprises.find(x=>x.id===id);if(!e)return empty('Entreprise introuvable');
  const us=SA.users.filter(u=>u.entreprise_id===id);
  const exp=e.date_contrat_fin&&e.date_contrat_fin<today();
  // Calcul jours restants
  let joursHtml='';
  if(e.date_contrat_fin){
    const jours=Math.ceil((new Date(e.date_contrat_fin)-new Date(today()))/864e5);
    const cls=jours<0?'danger':jours<=7?'danger':jours<=15?'warning':'';
    joursHtml=`<div class="alert ${cls}">📅 Contrat : ${jours<0?'EXPIRÉ depuis '+Math.abs(jours)+' j':jours+' jour(s) restant(s)'}</div>`;
  }
  return `<div class="card"><div class="who">${logo(e,52)}<div><h2 style="margin:0">${esc(e.nom)}</h2>${statutBadge(e.actif?'ACTIF':'SUSPENDU')}${exp?statutBadge('EXPIRE'):''}<small>${esc(e.slogan||'')}</small></div></div>
    <small>${esc(e.adresse||'')} · ${esc(e.telephone||'')} · ${esc(e.email||'')}</small>
    <small>Plan ${esc(e.plan)} · Devise ${esc(e.devise)} · Contrat : ${fd(e.date_contrat_debut)} → ${e.date_contrat_fin?fd(e.date_contrat_fin):'illimité'}</small>
    ${e.prix_contrat?`<small>Prix : ${money(e.prix_contrat)} · Durée : ${e.duree_mois} mois</small>`:''}
    ${joursHtml}
    ${e.notes?`<small>Notes : ${esc(e.notes)}</small>`:''}
    <div class="kpi" style="margin-top:12px">${card('Clients',e.nb_clients)}${card('Comptes',e.nb_comptes)}${card('Épargne',money(e.epargne),'green')}${card('Encours prêts',money(e.encours),'red')}</div>
    <div class="acts">
      <button class="btn" data-a="entedit" data-id="${esc(id)}">Modifier</button>
      <button class="btn alt" data-a="entplan" data-id="${esc(id)}">Plan / Renouveler</button>
      <button class="btn ${e.actif?'del':''}" data-a="enttoggle" data-id="${esc(id)}">${e.actif?'Suspendre l\'accès':'Réactiver l\'accès'}</button>
      <button class="btn del" data-a="entdelete" data-id="${esc(id)}">🗑 Supprimer définitivement</button>
    </div></div>
  <h2>Historique contrats</h2>
  <div class="acts"><button class="btn alt" data-a="enthisto" data-id="${esc(id)}">Voir l'historique</button></div>
  <h2>Utilisateurs (${e.nb_users_actifs}/${e.max_users})</h2>
  <div class="acts"><button class="btn" data-a="unew" data-id="${esc(id)}">+ Utilisateur</button></div>
  ${us.map(u=>userRow(u,false)).join('')||empty('Aucun utilisateur')}`;
};

/* ============================================================
   9. FORMULAIRES (SUB)
   ============================================================ */
const SUB={
  async flogin(f,d){
    try{await sbSignIn(d.email.trim(),d.pw)}catch(e){toast(errMsg(e),1);return}
    await initSession();
  },
  async fclient(f,d){
    const id=d.client_id||'';
    const p={nom_complet:d.nom_complet.trim(),nif_cin:d.nif_cin.trim(),telephone:d.telephone.trim(),email:d.email||null,
      adresse:d.adresse||null,ville:d.ville||null,date_naissance:d.date_naissance||null,sexe:d.sexe||'N',profession:d.profession||null};
    const {error}=await(id?sb.from('clients').update(p).eq('id',id):sb.from('clients').insert({...p,entreprise_id:db.entreprise.id}));
    if(error)throw error;
    toast('Client enregistré.');closeM();
    await refresh();render();
  },
  async fcompte(f,d){
    await sbRpc('rpc_ouvrir_compte',{p_client:d.client_id,p_type:+d.type_compte_id,p_depot:+d.depot_init||0,p_date:d.date||today()});
    toast('Compte créé.');closeM();
    await refresh();render();
  },
  async fop(f,d){
    await sbRpc(d.type_op==='RETRAIT'?'rpc_retrait':'rpc_depot',{p_compte:d.compte_id,p_montant:+d.montant,p_date:d.date||today(),p_desc:d.description||null});
    toast('Opération enregistrée.');closeM();
    await refresh();render();
  },
  async fpret(f,d){
    await sbRpc('rpc_creer_pret',{p_client:d.client_id,p_compte:d.compte_id,p_type:+d.type_pret_id,p_montant:+d.montant,p_duree:+d.duree_mois,p_date:d.date_debut||today()});
    toast('Demande enregistrée. En attente d\'approbation de l\'administrateur.');closeM();
    await refresh();render();
  },
  async fpaypret(f,d){
    await sbRpc('rpc_payer_pret',{p_pret:d.pret_id,p_montant:+d.montant,p_date:d.date||today(),p_desc:d.description||null});
    toast('Paiement enregistré.');closeM();
    await refresh();render();
  },
  async fent(f,d){
    const id=d.ent_id;
    const ent=isSA()?SA.entreprises.find(x=>x.id===id):db.entreprise;
    if(!ent)throw new Error('Entreprise introuvable');
    let logo_url=ent.logo_url;
    const file=f.querySelector('[name="logo_file"]')?.files?.[0];
    if(file)logo_url=await sbUploadPublic('logos',`${id}/logo-${Date.now()}.${(file.name.split('.').pop()||'png').toLowerCase()}`,file);
    const p={nom:d.nom.trim(),slogan:d.slogan||null,adresse:d.adresse||null,telephone:d.telephone||null,email:d.email||null,devise:d.devise||'HTG',logo_url};
    if(isSA()){p.max_users=Math.max(1,+d.max_users||1);p.plan=d.plan||'STANDARD';p.date_contrat_fin=d.date_contrat_fin||null;p.notes=d.notes||null}
    const {error}=await sb.from('entreprises').update(p).eq('id',id);
    if(error)throw error;
    if(!isSA()){Object.assign(db.entreprise,p);CUR=SYM[p.devise]||'G'}
    toast('Entreprise mise à jour.');closeM();
    if(isSA())await loadSA();else await loadAll();
    render();
  },
  async fentnew(f,d){
    const pw=d.admin_pw||'';
    if(pw.length<8)throw new Error('Mot de passe administrateur : 8 caractères minimum.');
    const id=await sbRpc('sa_create_entreprise',{p_nom:d.nom,p_slogan:d.slogan||null,p_adresse:d.adresse||null,p_tel:d.telephone||null,p_email:d.email||null,
      p_devise:d.devise||'HTG',p_max_users:+d.max_users||10,p_date_fin:d.date_contrat_fin||null,p_plan:d.plan||'STANDARD',p_notes:d.notes||null});
    const file=f.querySelector('[name="logo_file"]')?.files?.[0];
    if(file){try{const url=await sbUploadPublic('logos',`${id}/logo-${Date.now()}.${(file.name.split('.').pop()||'png').toLowerCase()}`,file);
      await sb.from('entreprises').update({logo_url:url}).eq('id',id)}catch(e){console.warn('logo:',e)}}
    try{
      const em=d.admin_email.trim().toLowerCase();
      const uid=await sbCreateAuthUser(em,pw);
      await sbRpc('register_profile',{p_id:uid,p_entreprise:id,p_username:em.split('@')[0],p_nom:d.admin_nom,p_tel:d.admin_tel||null,p_role:'ADMIN',p_email:em});
      toast('Entreprise et administrateur créés.');
    }catch(e){toast('Entreprise créée, mais administrateur NON créé : '+errMsg(e),1)}
    closeM();
    await loadSA();
    location.hash='#/entreprise/'+id;
    render();
  },
  async fuser(f,d){
    const em=(d.email||'').trim().toLowerCase();
    if((d.pw||'').length<8)throw new Error('Mot de passe : 8 caractères minimum.');
    await sbRpc('rpc_check_user_quota',{p_entreprise:d.ent_id});
    const uid=await sbCreateAuthUser(em,d.pw);
    await sbRpc('register_profile',{p_id:uid,p_entreprise:d.ent_id,p_username:em.split('@')[0],p_nom:d.nom_complet,p_tel:d.telephone||null,p_role:d.role,p_email:em});
    toast('Utilisateur créé. Communiquez-lui son mot de passe.');closeM();
    if(isSA())await loadSA();else await loadAll();
    render();
  },
  async fuseredit(f,d){
    const {error}=await sb.from('users').update({nom_complet:d.nom_complet||null,telephone:d.telephone||null,role:d.role,actif:d.actif==='1'}).eq('id',d.uid);
    if(error)throw error;
    toast('Utilisateur mis à jour.');closeM();
    if(isSA())await loadSA();else await loadAll();
    render();
  },
  async fprofil(f,d){
    let avatar_url=db.user.avatar_url;
    const file=f.querySelector('[name="avatar_file"]')?.files?.[0];
    if(file)avatar_url=await sbUploadPublic('avatars',`${db.user.id}/avatar-${Date.now()}.${(file.name.split('.').pop()||'png').toLowerCase()}`,file);
    const p={nom_complet:d.nom_complet||null,telephone:d.telephone||null,avatar_url};
    const {error}=await sb.from('users').update(p).eq('id',db.user.id);
    if(error)throw error;
    Object.assign(db.user,p);
    toast('Profil mis à jour.');closeM();
    render();
  },
  async fpw(f,d){
    if((d.pw||'').length<8)throw new Error('8 caractères minimum.');
    if(d.pw!==d.pw2)throw new Error('Les mots de passe ne correspondent pas.');
    await sbUpdatePw(d.pw);
    toast('Mot de passe modifié.');closeM();
  },
  async ftc(f,d){
    try{
      const p={
        nom: (d.nom||'').trim(),
        taux: parseFloat(d.taux)||0,
        depot_min: parseFloat(d.depot_min)||0,
        frais_ouv: parseFloat(d.frais_ouv)||0,
        frais_mens: parseFloat(d.frais_mens)||0,
        actif: d.actif==='1'
      };
      if(!p.nom) throw new Error('Le nom est obligatoire.');
      if(p.taux < 0) throw new Error('Le taux ne peut pas être négatif.');
      if(p.depot_min < 0 || p.frais_ouv < 0 || p.frais_mens < 0) throw new Error('Les montants doivent être positifs.');

      const {error} = d.id
        ? await sb.from('types_compte').update(p).eq('id', +d.id)
        : await sb.from('types_compte').insert({...p, entreprise_id: db.entreprise.id});
      if(error) throw error;

      toast('Type de compte enregistré.');
      closeM();
      await loadAll();
      render();
    }catch(e){
      console.error('ftc:', e);
      toast(errMsg(e), 1);
    }
  },
  async ftp(f,d){
    try{
      const p={
        nom: (d.nom||'').trim(),
        taux_mensuel: parseFloat(d.taux_mensuel)||0,
        duree_max: parseInt(d.duree_max)||1,
        montant_min: parseFloat(d.montant_min)||0,
        montant_max: parseFloat(d.montant_max)||0,
        frais: parseFloat(d.frais)||0,
        actif: d.actif==='1'
      };
      if(!p.nom) throw new Error('Le nom est obligatoire.');
      if(p.taux_mensuel <= 0) throw new Error('Le taux mensuel doit être supérieur à 0.');
      if(p.duree_max < 1) throw new Error('La durée doit être au moins 1 mois.');
      if(p.montant_max < p.montant_min) throw new Error('Le montant maximum doit être supérieur au montant minimum.');
      if(p.frais < 0) throw new Error('Les frais doivent être positifs.');

      const {error} = d.id
        ? await sb.from('types_pret').update(p).eq('id', +d.id)
        : await sb.from('types_pret').insert({...p, entreprise_id: db.entreprise.id});
      if(error) throw error;

      toast('Type de prêt enregistré.');
      closeM();
      await loadAll();
      render();
    }catch(e){
      console.error('ftp:', e);
      toast(errMsg(e), 1);
    }
  },
  /* ---------- SUPERADMIN : formulaire de plan ---------- */
  async fentplan(f,d){
    try{
      const plan=d.plan;
      const duree=plan==='CUSTOM'?parseInt(d.duree_mois):null;
      const prix=plan==='CUSTOM'?parseFloat(d.prix):null;
      const maxu=plan==='CUSTOM'&&d.max_users?parseInt(d.max_users):null;
      if(plan==='CUSTOM'){
        if(!(duree>0))throw new Error('Durée invalide.');
        if(!(prix>=0))throw new Error('Prix invalide.');
      }
      await sbApplyPlan(d.ent_id,plan,duree,prix,maxu);
      toast('Plan appliqué et contrat mis à jour.');
      closeM();
      await loadSA();
      render();
    }catch(e){
      console.error('fentplan:',e);
      toast(errMsg(e),1);
    }
  }
};

/* ============================================================
   10. ACTIONS
   ============================================================ */
const entFields=(e,sa)=>`
  <label>Nom *<input name="nom" required value="${esc(e.nom||'')}"></label>
  <label>Slogan<input name="slogan" value="${esc(e.slogan||'')}"></label>
  <label>Adresse<input name="adresse" value="${esc(e.adresse||'')}"></label>
  <label>Téléphone<input name="telephone" value="${esc(e.telephone||'')}"></label>
  <label>Email<input name="email" type="email" value="${esc(e.email||'')}"></label>
  <label>Devise<select name="devise">${['HTG','USD','EUR'].map(v=>`<option ${e.devise===v?'selected':''}>${v}</option>`).join('')}</select></label>
  <label>Logo (image, 2 Mo max)<input name="logo_file" type="file" accept="image/*"></label>
  ${sa?`<label>Utilisateurs max<input name="max_users" type="number" min="1" value="${e.max_users||10}" required></label>
  <label>Plan<select name="plan">${['STANDARD','PRO','PREMIUM'].map(v=>`<option ${e.plan===v?'selected':''}>${v}</option>`).join('')}</select></label>
  <label>Fin du contrat (vide = illimité)<input name="date_contrat_fin" type="date" value="${esc(e.date_contrat_fin||'')}"></label>
  <label>Notes internes<textarea name="notes" rows="2">${esc(e.notes||'')}</textarea></label>`:''}`;

const findUser=id=>(isSA()?SA.users:db.users).find(x=>x.id===id);

const ACT={
  closeM,
  print:()=>print(),
  async logout(){
    closeM();unsubscribe();
    try{await sbSignOut()}catch(e){}
    db=EMPTY();SA={entreprises:[],users:[],audit:[]};CUR='G';location.hash='';
    render();
  },
  async forgot(){
    const em=prompt('Entrez votre adresse email :');if(!em)return;
    await sbResetPw(em.trim());
    toast('Si ce compte existe, un lien de réinitialisation a été envoyé.');
  },
  newpw(){
    modal(`<h2>Nouveau mot de passe</h2><form id="fpw" class="form">
      <label>Nouveau mot de passe<input name="pw" type="password" minlength="8" required autocomplete="new-password"></label>
      <label>Confirmer<input name="pw2" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn big">Enregistrer</button></form>`);
  },
  chpw(){ACT.newpw()},

  /* ----- clients ----- */
  cform(id){
    const c=db.clients.find(x=>x.id===id)||{};
    modal(`<h2>${id?'Modifier le client':'Nouveau client'}</h2><form id="fclient" class="form">
      <input type="hidden" name="client_id" value="${esc(id||'')}">
      <label>Nom complet *<input name="nom_complet" required value="${esc(c.nom_complet)}"></label>
      <label>NIF/CIN *<input name="nif_cin" required value="${esc(c.nif_cin)}"></label>
      <label>Téléphone *<input name="telephone" required value="${esc(c.telephone)}"></label>
      <label>Email<input name="email" type="email" value="${esc(c.email)}"></label>
      <label>Adresse<input name="adresse" value="${esc(c.adresse)}"></label>
      <label>Ville<input name="ville" value="${esc(c.ville)}"></label>
      <label>Date de naissance<input name="date_naissance" type="date" value="${esc(c.date_naissance)}"></label>
      <label>Sexe<select name="sexe">${[['M','M'],['F','F'],['O','Autre'],['N','Non précisé']].map(([v,l])=>`<option value="${v}" ${(c.sexe||'N')===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <label>Profession<input name="profession" value="${esc(c.profession)}"></label>
      <button class="btn big">Enregistrer</button>${cancel}</form>`);
  },
  async delc(id){
    if(db.comptes.some(c=>c.client_id===id)||db.prets.some(p=>p.client_id===id))throw new Error('Impossible : ce client a des comptes ou des prêts.');
    if(!confirm('Supprimer ce client ?'))return;
    const {error}=await sb.from('clients').delete().eq('id',id);
    if(error)throw error;
    toast('Client supprimé.');location.hash='#/clients';
  },

  /* ----- comptes & opérations ----- */
  ccompte(clientId){
    modal(`<h2>Ouvrir un compte</h2><form id="fcompte" class="form">
      <label>Client<select name="client_id" required>${clientOpts(clientId)}</select></label>
      <label>Type de compte<select name="type_compte_id" required>${typeCompteOpts()}</select></label>
      <label>Dépôt initial<input name="depot_init" type="number" step="0.01" min="0" value="0"></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <button class="btn big">Créer le compte</button>${cancel}</form>`);
  },
  cdepot(compteId){
    modal(`<h2>Dépôt</h2><form id="fop" class="form">
      <input type="hidden" name="type_op" value="DEPOT"><input type="hidden" name="compte_id" value="${esc(compteId)}">
      <label>Montant<input name="montant" type="number" step="0.01" min="0.01" required></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Description<input name="description"></label>
      <button class="btn big">Valider</button>${cancel}</form>`);
  },
  cretrait(compteId){
    modal(`<h2>Retrait</h2><form id="fop" class="form">
      <input type="hidden" name="type_op" value="RETRAIT"><input type="hidden" name="compte_id" value="${esc(compteId)}">
      <label>Montant<input name="montant" type="number" step="0.01" min="0.01" required></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Description<input name="description"></label>
      <button class="btn big">Valider</button>${cancel}</form>`);
  },
  async ccloture(id){
    const cp=compteById(id);if(!cp)return;
    if(!confirm(`Clôturer le compte ${cp.numero_compte_interne} ? Le solde de ${money(cp.solde)} sera remis au client.`))return;
    await sbRpc('rpc_cloturer_compte',{p_compte:id});
    toast('Compte clôturé.');
    await loadAll();render();
  },

  /* ----- prêts ----- */
  cpret(){
    modal(`<h2>Nouveau prêt</h2><form id="fpret" class="form">
      <label>Client<select name="client_id" required>${clientOpts()}</select></label>
      <label>Compte épargne du client<select name="compte_id" required>${compteOptsFor('__none__')}</select></label>
      <label>Type de prêt<select name="type_pret_id" required>${typePretOpts()}</select></label>
      <label>Montant<input name="montant" type="number" step="0.01" min="0.01" required></label>
      <label>Durée (mois)<input name="duree_mois" type="number" min="1" value="12" required></label>
      <label>Date de début<input name="date_debut" type="date" value="${today()}" required></label>
      <div id="sim" class="alert warning"></div>
      <small>Le taux est imposé par le type de prêt. La demande doit être approuvée par l'administrateur de l'entreprise.</small>
      <button class="btn big">Créer la demande</button>${cancel}</form>`);
    setTimeout(()=>simPret($('#fpret')),50);
  },
  async apret(id){
    const p=pretById(id);if(!p||p.statut!=='DEMANDE')throw new Error('Ce prêt n\'est pas approuvable.');
    if(!confirm(`Approuver et décaisser ${money(p.montant-(+p.frais_dossier||0))} (frais de dossier ${money(p.frais_dossier)} retenus) ?`))return;
    await sbRpc('rpc_approuver_pret',{p_pret:id});
    toast('Prêt approuvé et décaissé.');
    await loadAll();render();
  },
  async rpret(id){
    const p=pretById(id);if(!p||p.statut!=='DEMANDE')throw new Error('Ce prêt n\'est pas rejetable.');
    const motif=prompt('Motif du rejet ?');if(motif===null)return;
    await sbRpc('rpc_rejeter_pret',{p_pret:id,p_motif:motif});
    toast('Prêt rejeté.');
    await loadAll();render();
  },
  ppay(id){
    const p=pretById(id);if(!p)return;
    modal(`<h2>Paiement ${esc(p.numero_pret)}</h2><form id="fpaypret" class="form">
      <input type="hidden" name="pret_id" value="${esc(id)}">
      <small>Reste à payer : <b>${money(p.solde_restant)}</b> · Mensualité : ${money(p.mensualite)}</small>
      <label>Montant<input name="montant" type="number" step="0.01" min="0.01" max="${p.solde_restant}" value="${Math.min(p.mensualite,p.solde_restant)}" required></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Description<input name="description"></label>
      <button class="btn big">Valider</button>${cancel}</form>`);
  },

  /* ----- entreprise (admin) ----- */
  cent(){
    const e=db.entreprise;if(!e)return;
    modal(`<h2>Configurer l'entreprise</h2><form id="fent" class="form"><input type="hidden" name="ent_id" value="${esc(e.id)}">${entFields(e,false)}<button class="btn big">Enregistrer</button>${cancel}</form>`);
  },

  /* ----- types de produits ----- */
  tcform(id){
    const t=db.types_compte.find(x=>String(x.id)===String(id))||{actif:true};
    modal(`<h2>${id?'Modifier':'Nouveau'} type de compte</h2><form id="ftc" class="form"><input type="hidden" name="id" value="${esc(id||'')}">
      <label>Nom *<input name="nom" required value="${esc(t.nom||'')}"></label>
      <label>Taux d'intérêt annuel (%)<input name="taux" type="number" step="0.01" min="0" value="${t.taux??0}"></label>
      <label>Dépôt minimum<input name="depot_min" type="number" step="0.01" min="0" value="${t.depot_min??0}"></label>
      <label>Frais d'ouverture<input name="frais_ouv" type="number" step="0.01" min="0" value="${t.frais_ouv??0}"></label>
      <label>Frais mensuels<input name="frais_mens" type="number" step="0.01" min="0" value="${t.frais_mens??0}"></label>
      <label>Statut<select name="actif"><option value="1" ${t.actif!==false?'selected':''}>Actif</option><option value="0" ${t.actif===false?'selected':''}>Inactif</option></select></label>
      <button class="btn big" type="submit">Enregistrer</button>${cancel}</form>`);
  },
  tpform(id){
    const t=db.types_pret.find(x=>String(x.id)===String(id))||{actif:true,taux_mensuel:1,duree_max:12,montant_min:1000,montant_max:50000,frais:0};
    modal(`<h2>${id?'Modifier':'Nouveau'} type de prêt</h2><form id="ftp" class="form"><input type="hidden" name="id" value="${esc(id||'')}">
      <label>Nom *<input name="nom" required value="${esc(t.nom||'')}"></label>
      <label>Taux mensuel (%)<input name="taux_mensuel" type="number" step="0.01" min="0.01" value="${t.taux_mensuel}" required></label>
      <label>Durée maximale (mois)<input name="duree_max" type="number" min="1" value="${t.duree_max}" required></label>
      <label>Montant minimum<input name="montant_min" type="number" step="0.01" min="0" value="${t.montant_min}" required></label>
      <label>Montant maximum<input name="montant_max" type="number" step="0.01" min="0" value="${t.montant_max}" required></label>
      <label>Frais de dossier<input name="frais" type="number" step="0.01" min="0" value="${t.frais}"></label>
      <label>Statut<select name="actif"><option value="1" ${t.actif!==false?'selected':''}>Actif</option><option value="0" ${t.actif===false?'selected':''}>Inactif</option></select></label>
      <button class="btn big" type="submit">Enregistrer</button>${cancel}</form>`);
  },

  /* ----- alertes ----- */
  async nread(id){const {error}=await sb.from('notifications').update({lu:true}).eq('id',id);if(error)throw error;await loadAll();render()},
  async nreadall(){
    const {error}=await sb.from('notifications').update({lu:true}).eq('entreprise_id',db.entreprise.id).eq('lu',false);
    if(error)throw error;
    await loadAll();render();
  },

  /* ----- utilisateurs ----- */
  unew(entId){
    const eid=isSA()?entId:db.entreprise.id;
    modal(`<h2>Nouvel utilisateur</h2><form id="fuser" class="form"><input type="hidden" name="ent_id" value="${esc(eid)}">
      <label>Nom complet *<input name="nom_complet" required></label>
      <label>Email *<input name="email" type="email" required autocomplete="off"></label>
      <label>Téléphone<input name="telephone"></label>
      <label>Rôle<select name="role">${roleOpts('AGENT')}</select></label>
      <label>Mot de passe initial (8 car. min.)<input name="pw" type="text" minlength="8" required autocomplete="off"></label>
      <small><b>Administrateur</b> : tout + approbation des prêts · <b>Agent</b> : clients, comptes, demandes de prêt · <b>Caissier</b> : dépôts, retraits, paiements.</small>
      <button class="btn big">Créer l'utilisateur</button>${cancel}</form>`);
  },
  uedit(id){
    const u=findUser(id);if(!u)return;
    modal(`<h2>Modifier l'utilisateur</h2><small>${esc(u.email||'')}</small><form id="fuseredit" class="form"><input type="hidden" name="uid" value="${esc(id)}">
      <label>Nom complet<input name="nom_complet" value="${esc(u.nom_complet)}"></label>
      <label>Téléphone<input name="telephone" value="${esc(u.telephone)}"></label>
      <label>Rôle<select name="role">${roleOpts(u.role)}</select></label>
      <label>Statut<select name="actif"><option value="1" ${u.actif?'selected':''}>Actif</option><option value="0" ${u.actif?'':'selected'}>Désactivé</option></select></label>
      <button class="btn big">Enregistrer</button>
      <button type="button" class="btn alt big" data-a="uresetpw" data-id="${esc(id)}">Envoyer un lien de réinitialisation du mot de passe</button>${cancel}</form>`);
  },
  async utoggle(id){
    const u=findUser(id);if(!u)return;
    if(!confirm(`${u.actif?'Désactiver':'Réactiver'} ${u.nom_complet||u.username} ?`))return;
    const {error}=await sb.from('users').update({actif:!u.actif}).eq('id',id);
    if(error)throw error;
    toast(u.actif?'Utilisateur désactivé.':'Utilisateur réactivé.');
    if(isSA())await loadSA();else await loadAll();
    render();
  },
  async uresetpw(id){
    const u=findUser(id);if(!u||!u.email)return;
    await sbResetPw(u.email);
    toast('Lien de réinitialisation envoyé à '+u.email);
  },
  profil(){
    const u=db.user;
    modal(`<h2>Mon profil</h2><form id="fprofil" class="form">
      <div class="who">${avatar(u,56)}<small>${esc(u.email||'')}</small></div>
      <label>Nom complet<input name="nom_complet" value="${esc(u.nom_complet||'')}" required></label>
      <label>Téléphone<input name="telephone" value="${esc(u.telephone||'')}"></label>
      <label>Photo (2 Mo max)<input name="avatar_file" type="file" accept="image/*"></label>
      <button class="btn big">Enregistrer</button>${cancel}</form>`);
  },

  /* ----- super admin ----- */
  entnew(){
    modal(`<h2>Nouvelle entreprise</h2><form id="fentnew" class="form">
      ${entFields({devise:'HTG',max_users:10,plan:'STANDARD'},true)}
      <h2>Administrateur de l'entreprise</h2>
      <label>Nom complet *<input name="admin_nom" required></label>
      <label>Email *<input name="admin_email" type="email" required autocomplete="off"></label>
      <label>Téléphone<input name="admin_tel"></label>
      <label>Mot de passe initial (8 car. min.)<input name="admin_pw" type="text" minlength="8" required autocomplete="off"></label>
      <button class="btn big">Créer l'entreprise</button>${cancel}</form>`);
  },
  entedit(id){
    const e=SA.entreprises.find(x=>x.id===id);if(!e)return;
    modal(`<h2>Modifier l'entreprise</h2><form id="fent" class="form"><input type="hidden" name="ent_id" value="${esc(id)}">${entFields(e,true)}<button class="btn big">Enregistrer</button>${cancel}</form>`);
  },
  async enttoggle(id){
    const e=SA.entreprises.find(x=>x.id===id);if(!e)return;
    const msg=e.actif?`Suspendre l'accès de « ${e.nom} » ? Tous ses utilisateurs seront bloqués immédiatement.`:`Réactiver l'accès de « ${e.nom} » ?`;
    if(!confirm(msg))return;
    await sbRpc('sa_toggle_entreprise',{p_id:id,p_actif:!e.actif});
    toast(e.actif?'Accès suspendu.':'Accès réactivé.');
    await loadSA();render();
  },

  /* ============================================================
     SUPERADMIN — Suppression d'entreprise
     ============================================================ */
  async entdelete(id){
    const e=SA.entreprises.find(x=>x.id===id);
    if(!e)throw new Error('Entreprise introuvable');
    const saisie=prompt(
      `⚠️ SUPPRESSION DÉFINITIVE\n\n`+
      `Entreprise : ${e.nom}\n`+
      `Toutes ses données (clients, comptes, prêts, utilisateurs…) seront effacées.\n\n`+
      `Tapez le nom exact « ${e.nom} » pour confirmer :`
    );
    if(saisie===null)return;
    if(saisie.trim()!==e.nom){toast('Nom incorrect. Suppression annulée.',1);return;}
    await sbDeleteEntreprise(id);
    toast('Entreprise supprimée définitivement.');
    await loadSA();
    location.hash='#/entreprises';
    render();
  },

  /* ============================================================
     SUPERADMIN — Appliquer / renouveler un plan
     ============================================================ */
  entplan(id){
    const e=SA.entreprises.find(x=>x.id===id);
    if(!e)return;
    modal(`<h2>Plan / Renouvellement</h2>
      <small>Entreprise : <b>${esc(e.nom)}</b></small>
      <form id="fentplan" class="form">
        <input type="hidden" name="ent_id" value="${esc(id)}">
        <label>Plan<select name="plan" required>
          <option value="STANDARD">STANDARD — 4 500 HTG / 3 mois / 3 users</option>
          <option value="PRO">PRO — 15 000 HTG / 6 mois / 8 users</option>
          <option value="PREMIUM">PREMIUM — 48 000 HTG / 12 mois / 20 users</option>
          <option value="CUSTOM">LICENCE PERSONNALISÉE</option>
        </select></label>
        <label>Durée (mois) — CUSTOM uniquement<input name="duree_mois" type="number" min="1" value="${e.duree_mois||3}"></label>
        <label>Prix (HTG) — CUSTOM uniquement<input name="prix" type="number" step="0.01" min="0" value="${e.prix_contrat||0}"></label>
        <label>Utilisateurs max — CUSTOM uniquement<input name="max_users" type="number" min="1" value="${e.max_users||10}"></label>
        <small>Les champs durée/prix/max_users ne sont utilisés que si le plan choisi est CUSTOM.</small>
        <button class="btn big" type="submit">Appliquer le plan</button>${cancel}
      </form>`);
  },

  /* ============================================================
     SUPERADMIN — Alertes contrats
     ============================================================ */
  async contratsalertes(){
    const rows=await sbContratsAlertes();
    if(!rows||!rows.length){toast('Aucun contrat à surveiller.');return;}
    modal(`<h2>Alertes contrats</h2>
      <div class="card">
        ${rows.map(r=>`<div class="row" style="margin-bottom:6px">
          <div><b>${esc(r.nom)}</b><small>${esc(r.plan)} · fin ${fd(r.date_fin)}</small></div>
          <div class="amt ${r.niveau_alerte==='EXPIRE'?'red':r.niveau_alerte==='OK'?'green':'or'}">
            ${r.jours_restants} j
            ${r.niveau_alerte!=='OK'?`<small>${esc(r.niveau_alerte)}</small>`:''}
          </div></div>`).join('')}
      </div>`);
  },

  /* ============================================================
     SUPERADMIN — Suspendre les entreprises expirées
     ============================================================ */
  async suspendexpired(){
    if(!confirm('Suspendre automatiquement toutes les entreprises dont le contrat est expiré ?'))return;
    const n=await sbSuspendExpired();
    toast(`${n??0} entreprise(s) suspendue(s).`);
    await loadSA();
    render();
  },

  /* ============================================================
     SUPERADMIN — Historique des contrats
     ============================================================ */
  async enthisto(id){
    try{
      const rows=await sbContratHistorique(id);
      if(!rows||!rows.length){toast('Aucun historique de contrat.');return;}
      modal(`<h2>Historique des contrats</h2>
        <div class="card">
          ${rows.map(r=>`<div class="row" style="margin-bottom:6px">
            <div><b>${esc(r.plan)}</b><small>${fd(r.date_debut)} → ${fd(r.date_fin)} · ${r.duree_mois} mois</small></div>
            <div class="amt green">${money(r.prix)}</div>
          </div>`).join('')}
        </div>`);
    }catch(e){toast(errMsg(e),1)}
  },

  csv(){
    const rows=[['Type','Date','Client','Montant','Description']];
    db.depots.forEach(d=>{const cp=compteById(d.compte_id),cl=cp?clientById(cp.client_id):null;rows.push(['DEPOT',d.date_operation,cl?cl.nom_complet:'',d.montant,d.description||''])});
    db.retraits.forEach(d=>{const cp=compteById(d.compte_id),cl=cp?clientById(cp.client_id):null;rows.push(['RETRAIT',d.date_operation,cl?cl.nom_complet:'',-d.montant,d.description||''])});
    db.prets.forEach(p=>{const cl=clientById(p.client_id);rows.push(['PRET',p.date_debut,cl?cl.nom_complet:'',p.montant,`Total=${p.montant_total} Reste=${p.solde_restant} Statut=${p.statut}`])});
    dl(`ayifin-${today()}.csv`,'\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n'),'text/csv');
  }
};

/* ============================================================
   11. RENDU
   ============================================================ */
const TITLES={client:'Fiche client',compte:'Compte',pret:'Prêt',entreprise:'Entreprise'};
function render(){
  theme();
  const app=$('#app');if(!app)return;
  if(db.blocked){app.innerHTML=blockedV();return}
  if(!db.user){app.innerHTML=loginV();return}
  const parts=(location.hash.slice(2)||'dashboard').split('/');
  let key=Object.prototype.hasOwnProperty.call(V,parts[0])?parts[0]:'dashboard';
  if(!ACCESS[key]||!ACCESS[key].includes(role()))key='dashboard';
  const arg=parts[1]||'';
  const cur={client:'clients',compte:'comptes',pret:'prets',entreprise:'entreprises'}[key]||key;
  const nav=navFor();
  const un=unread();
  const link=(n,c)=>`<a href="#/${n[0]}" class="${cur===n[0]?'on':''}">${ico(n[2])}${c?n[1]:''}${n[0]==='notifications'&&un?`<i class="dot">${un}</i>`:''}</a>`;
  const ti=TITLES[key]||(nav.find(n=>n[0]===cur)||[0,'AYIFIN'])[1];
  const e=db.entreprise;
  const brand=e
    ?`<div class="brandbox">${logo(e,36)}<div style="flex:1;min-width:0"><div class="bn">${esc(e.nom||'AYIFIN')}</div><div class="bs">${esc(e.slogan||'')}</div></div></div>`
    :`<div class="brandbox"><div class="ava sq" style="width:36px;height:36px;background:#ffffff22">AY</div><div style="flex:1;min-width:0"><div class="bn">AYIFIN</div><div class="bs">Super Administration</div></div></div>`;
  const content=V[key](arg);
  app.innerHTML=`<aside class="side">${brand}${nav.map(n=>link(n,1)).join('')}<div class="me">${esc(db.user.nom_complet||db.user.username)}<br>${esc(ROLE_LBL[role()]||'')}</div></aside><main><header class="top"><h1>${esc(ti)}</h1><div class="topi">${nav.slice(5).map(n=>link(n)).join('')}</div></header><section class="view">${content}</section></main><nav class="bot">${nav.slice(0,5).map(n=>link(n,1)).join('')}</nav>`;
  if(render.h!==location.hash){scrollTo(0,0);render.h=location.hash}
  if(key==='prets'||key==='pret')document.title='AYIFIN — Prêts';else document.title='AYIFIN — '+ti;
}

/* ============================================================
   12. DÉLÉGATION D'ÉVÉNEMENTS
   ============================================================ */
function simPret(f){
  if(!f)return;
  const box=f.querySelector('#sim');if(!box)return;
  const tp=db.types_pret.find(t=>String(t.id)===f.elements.type_pret_id.value);
  const c=+f.elements.montant.value,d=+f.elements.duree_mois.value;
  if(!tp){box.textContent='Choisissez un type de prêt.';return}
  if(!(c>0)||!(d>0)){box.innerHTML=`Taux <b>${tp.taux_mensuel}%</b>/mois · Montant ${money(tp.montant_min)}–${money(tp.montant_max)} · Durée max ${tp.duree_max} mois`;return}
  const s=simul(c,tp.taux_mensuel,d);
  box.innerHTML=`Taux <b>${tp.taux_mensuel}%</b>/mois · Intérêt ${money(s.int)} · Total ${money(s.tot)} · <b>Mensualité ${money(s.mens)}</b> · Frais dossier ${money(tp.frais)}`;
}

document.addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.target;if(!(f instanceof HTMLFormElement))return;
  const key=f.getAttribute('id')||'';
  const h=SUB[key];
  if(typeof h!=='function'){
    console.error('❌ Formulaire sans handler :', key, '— SUB keys :', Object.keys(SUB));
    toast('Formulaire inconnu (id="'+key+'").',1);
    return;
  }
  const btn=f.querySelector('button.big,button[type="submit"]');
  if(btn)btn.disabled=true;
  try{
    await h(f,Object.fromEntries(new FormData(f)));
  }catch(err){
    console.error('submit ['+key+']:',err);
    toast(errMsg(err),1);
  }
  finally{
    if(btn)btn.disabled=false;
  }
});

document.addEventListener('click',e=>{
  if(e.target.id==='modal')return closeM();
  const b=e.target.closest('[data-a]');if(!b)return;
  const fn=ACT[b.dataset.a];
  if(typeof fn!=='function'){
    console.warn('Action inconnue :',b.dataset.a);
    return;
  }
  Promise.resolve().then(()=>fn(b.dataset.id,b.dataset))
    .then(async()=>{
      if(db.user&&!db.blocked)await refresh();
      render();
      if(b.dataset.a==='cpret')simPret($('#fpret'));
    })
    .catch(err=>{console.error('action ['+b.dataset.a+']:',err);toast(errMsg(err),1)});
});

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeM()});

document.addEventListener('input',e=>{
  const t=e.target;
  const form=t.closest&&t.closest('form');
  if(form&&form.id==='fpret'){
    if(t.name==='client_id')form.elements.compte_id.innerHTML=compteOptsFor(t.value||'__none__');
    simPret(form);
  }
  const n=t.dataset&&t.dataset.f;if(!n)return;
  if(n==='theme'){localStorage.setItem(T,t.value);return theme()}
  F[n]=t.value;
  if(n==='q'&&$('#clist'))$('#clist').innerHTML=clist();
  else if(n==='q'&&$('#elist'))$('#elist').innerHTML=elist();
  else if(n==='uq'&&$('#ulist'))$('#ulist').innerHTML=ulist();
  else if(n==='pstatut')render();
});

/* ============================================================
   13. INIT
   ============================================================ */
window.addEventListener('DOMContentLoaded',async()=>{
  theme();
  if(!initSupabase()){const a=$('#app');if(a)a.innerHTML='<div class="auth"><h1>AYIFIN</h1><div class="alert danger">Impossible de charger Supabase. Vérifiez votre connexion internet.</div></div>';return}
  sbOnAuth(ev=>{
    if(ev==='PASSWORD_RECOVERY')setTimeout(()=>ACT.newpw(),300);
    if(ev==='SIGNED_OUT'&&db.user){setTimeout(()=>{unsubscribe();db=EMPTY();render()},0)}
  });
  await initSession();
});
window.addEventListener('hashchange',render);
