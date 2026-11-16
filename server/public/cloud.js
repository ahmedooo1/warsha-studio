/*
 * Warsha Studio, workshop edition: connects the editor to the workshop's own server.
 * Loaded only when the page comes from that server. The editor works the same without it (GitHub Pages, Claude).
 *
 * Local first: every design is kept on this device (IndexedDB) and every change waits in an outbox until the server
 * has it. The page works without network and catches up when it comes back. Each change names the version it was made
 * on; if another device saved first, the server refuses it, and both versions are kept (yours as a copy marked
 * "تعارض") until someone chooses. Nothing is overwritten without having been seen.
 */
(function () {
  'use strict';
  const MODE = window.WARSHA_MODE === 'view' ? 'view' : 'app';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^\w-]/g, '');
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- words: Arabic, French, Turkish (the editor's languages) ---------- */
  const W = {
    signIn: ['تسجيل الدخول', 'Connexion', 'Giriş'], email: ['البريد الإلكتروني', 'E-mail', 'E-posta'], password: ['كلمة المرور', 'Mot de passe', 'Şifre'],
    enter: ['دخول', 'Entrer', 'Gir'], wrong: ['البريد أو كلمة المرور غير صحيحة', 'E-mail ou mot de passe incorrect', 'E-posta veya şifre hatalı'],
    locked: ['الحساب مقفل لبضع دقائق بعد محاولات كثيرة', 'Compte bloqué quelques minutes après trop d\'essais', 'Çok fazla deneme, hesap birkaç dakika kilitli'],
    tooMany: ['محاولات كثيرة، انتظر دقيقة', 'Trop d\'essais, attendez une minute', 'Çok fazla deneme, bir dakika bekleyin'],
    offlineNoCache: ['لا اتصال بخادم الورشة، ولم يُفتح البرنامج على هذا الجهاز من قبل', 'Pas de connexion au serveur de l\'atelier, et cet appareil ne l\'a jamais ouvert', 'Atölye sunucusuna bağlantı yok'],
    setupTitle: ['تجهيز الورشة لأول مرة', 'Première mise en service', 'İlk kurulum'],
    setupHint: ['رمز التجهيز مكتوب في إعدادات الخادم (SETUP_TOKEN). يُنشأ حساب صاحب الورشة.', 'Le code de mise en service est dans la configuration du serveur (SETUP_TOKEN). Le compte du patron est créé.', 'Kurulum kodu sunucu ayarlarındadır (SETUP_TOKEN).'],
    setupToken: ['رمز التجهيز', 'Code de mise en service', 'Kurulum kodu'], yourName: ['الاسم', 'Nom', 'Ad'],
    pass2: ['كلمة المرور مرة ثانية', 'Mot de passe (confirmation)', 'Şifre (tekrar)'], create: ['إنشاء الحساب', 'Créer le compte', 'Hesap oluştur'],
    passShort: ['كلمة المرور 10 أحرف على الأقل', '10 caractères minimum', 'En az 10 karakter'], passDiff: ['كلمتا المرور مختلفتان', 'Les mots de passe diffèrent', 'Şifreler farklı'],
    badToken: ['رمز التجهيز غير صحيح', 'Code de mise en service incorrect', 'Kurulum kodu hatalı'],
    synced: ['متزامن', 'Synchronisé', 'Eşitlendi'], syncing: ['يزامن…', 'Synchronisation…', 'Eşitleniyor…'],
    waiting: ['بانتظار الاتصال', 'En attente de connexion', 'Bağlantı bekleniyor'], conflict: ['تعارض', 'Conflit', 'Çakışma'],
    signedOut: ['انتهت الجلسة', 'Session terminée', 'Oturum sona erdi'], problem: ['مشكلة حفظ', 'Problème d\'envoi', 'Gönderim sorunu'],
    pending: ['تغييرات بانتظار الإرسال', 'changements en attente', 'bekleyen değişiklik'], lastSync: ['آخر مزامنة', 'Dernière synchro', 'Son eşitleme'],
    device: ['اسم هذا الجهاز', 'Nom de cet appareil', 'Bu cihazın adı'], admin: ['إدارة الورشة', 'Gestion de l\'atelier', 'Atölye yönetimi'],
    signOut: ['تسجيل الخروج', 'Se déconnecter', 'Çıkış'], syncNow: ['زامن الآن', 'Synchroniser', 'Şimdi eşitle'], close: ['إغلاق', 'Fermer', 'Kapat'],
    signOutPending: ['على هذا الجهاز تغييرات لم تصل الخادم بعد. انتظر الاتصال قبل الخروج، أو اضغط مرة ثانية للخروج وإبقائها محفوظة هنا.', 'Des changements ne sont pas encore sur le serveur. Attendez la connexion, ou appuyez encore pour sortir en les gardant sur cet appareil.', 'Sunucuya ulaşmamış değişiklikler var.'],
    conflictTitle: ['تعارض بين جهازين', 'Conflit entre deux appareils', 'İki cihaz arasında çakışma'],
    conflictText: ['عُدّل التصميم «{n}» على جهاز آخر قبل وصول تعديلك. احتفظنا بالنسختين: نسخة الجهاز الآخر باسمها، ونسختك باسم «{n}» مع علامة «تعارض».', 'Le projet « {n} » a été modifié sur un autre appareil avant l\'arrivée de votre modification. Les deux versions sont gardées : celle de l\'autre appareil sous son nom, la vôtre marquée « تعارض ».', '«{n}» başka bir cihazda değiştirildi. İki sürüm de saklandı.'],
    keepBoth: ['أبقِ النسختين', 'Garder les deux', 'İkisini de tut'], keepMine: ['اعتمد نسختي', 'Garder la mienne', 'Benimkini tut'], keepTheirs: ['اعتمد نسخة الجهاز الآخر', 'Garder celle de l\'autre appareil', 'Diğerini tut'],
    delConflict: ['لم يُحذف «{n}»: عدّله جهاز آخر قبل الحذف. أعدناه كما هو على الخادم.', '« {n} » n\'a pas été supprimé : un autre appareil l\'a modifié avant. Il est revenu tel qu\'il est sur le serveur.', '«{n}» silinmedi: başka cihaz değiştirdi.'],
    setConflict: ['تغيّرت أسعار الورشة أو إعدادات التصنيع على جهاز آخر قبل وصول تعديلك.', 'Les prix ou réglages de l\'atelier ont changé sur un autre appareil avant votre modification.', 'Fiyatlar başka bir cihazda değişti.'],
    staffSettings: ['تعديل الأسعار والإعدادات يحفظه صاحب الورشة فقط. تعديلك باقٍ على هذا الجهاز ولن يصل الخادم.', 'Seul le patron enregistre les prix et réglages. Votre modification reste sur cet appareil.', 'Fiyatları yalnızca atölye sahibi kaydeder.'],
    rejected: ['رفض الخادم هذا التغيير', 'Changement refusé par le serveur', 'Sunucu bu değişikliği reddetti'], download: ['تنزيله', 'Le télécharger', 'İndir'],
    issueBtn: ['إصدار عرض سعر رسمي مرقّم', 'Émettre un devis numéroté', 'Numaralı teklif düzenle'],
    issueHint: ['يأخذ رقماً متسلسلاً، ويُحفظ على الخادم كما هو مع التصميم والأسعار والضريبة وهوية الورشة، ولا يتغير بعد ذلك.', 'Prend un numéro qui se suit, et se garde sur le serveur tel quel avec le projet, les prix, la TVA et l\'identité de l\'atelier. Il ne change plus ensuite.', 'Sıralı numara alır ve sunucuda değişmez şekilde saklanır.'],
    needClient: ['احفظ التصميم باسم الزبون أولاً، ثم أصدر العرض.', 'Enregistrez d\'abord le projet au nom du client.', 'Önce tasarımı müşteri adıyla kaydedin.'],
    needSave: ['في الشاشة تعديلات لم تُحفظ. اضغط «حفظ» أولاً، ثم أصدر العرض.', 'Des modifications ne sont pas enregistrées. Appuyez sur « حفظ » d\'abord.', 'Kaydedilmemiş değişiklikler var.'],
    needNet: ['إصدار العرض يحتاج اتصالاً بخادم الورشة.', 'L\'émission d\'un devis demande la connexion au serveur.', 'Sunucu bağlantısı gerekli.'],
    pricesDiffer: ['الأسعار على هذا الجهاز تختلف عن أسعار الورشة على الخادم، فلا يصدر عرض بأسعار غير محفوظة.', 'Les prix de cet appareil diffèrent de ceux du serveur : pas de devis avec des prix non enregistrés.', 'Bu cihazdaki fiyatlar sunucudakinden farklı.'],
    projChanged: ['التصميم على الخادم ليس الذي على الشاشة. انتظر المزامنة ثم أعد المحاولة.', 'Le projet du serveur n\'est pas celui à l\'écran. Attendez la synchro puis réessayez.', 'Sunucudaki tasarım ekrandakinden farklı.'],
    issuing: ['يصدر العرض…', 'Émission…', 'Düzenleniyor…'],
    issued: ['صدر العرض {num} وحُفظ على الخادم.', 'Devis {num} émis et gardé sur le serveur.', '{num} teklifi düzenlendi.'],
    pdfLater: ['أُخذ الرقم {num}، وسيُرسل ملف PDF إلى الخادم عند عودة الاتصال. لا تحذف بيانات المتصفح قبل ذلك.', 'Numéro {num} pris ; le PDF partira au serveur au retour de la connexion.', '{num} alındı, PDF bağlantı gelince gönderilecek.'],
    issueFail: ['تعذّر إصدار العرض', 'Le devis n\'a pas pu être émis', 'Teklif düzenlenemedi'],
    linkBtn: ['رابط للزبون', 'Lien pour le client', 'Müşteri bağlantısı'], linkDays: ['صالح لمدة', 'Valable', 'Geçerlilik'], days: ['يوماً', 'jours', 'gün'],
    linkPin: ['رمز اختياري من 4 إلى 8 أرقام', 'Code facultatif (4 à 8 chiffres)', 'İsteğe bağlı kod'], makeLink: ['أنشئ الرابط', 'Créer le lien', 'Oluştur'],
    linkMade: ['الرابط للقراءة فقط، ويمكن إيقافه من إدارة الورشة. لا يظهر مرة ثانية، فانسخه الآن.', 'Lien en lecture seule, révocable depuis la gestion de l\'atelier. Il ne sera plus affiché : copiez-le maintenant.', 'Bağlantı yalnızca okunur.'],
    copy: ['نسخ', 'Copier', 'Kopyala'], copied: ['نُسخ', 'Copié', 'Kopyalandı'], whatsapp: ['واتساب', 'WhatsApp', 'WhatsApp'],
    // client view
    vLoading: ['يفتح التصميم…', 'Ouverture du projet…', 'Tasarım açılıyor…'], vPinTitle: ['أدخل الرمز الذي أعطتك إياه الورشة', 'Entrez le code donné par l\'atelier', 'Atölyenin verdiği kodu girin'],
    vPinWrong: ['الرمز غير صحيح', 'Code incorrect', 'Kod hatalı'], vOpen: ['فتح', 'Ouvrir', 'Aç'], vEnded: ['انتهى هذا الرابط. اطلب من الورشة رابطاً جديداً.', 'Ce lien a pris fin. Demandez-en un nouveau à l\'atelier.', 'Bu bağlantının süresi doldu.'],
    vNotFound: ['الرابط غير موجود', 'Lien introuvable', 'Bağlantı bulunamadı'], vQuote: ['عرض السعر', 'Devis', 'Teklif'], vTotal: ['الإجمالي', 'Total', 'Toplam'],
    vPdf: ['تحميل عرض السعر PDF', 'Télécharger le devis PDF', 'Teklifi indir (PDF)'], vAccept: ['أوافق على العرض', 'J\'accepte le devis', 'Teklifi kabul ediyorum'],
    vAcceptText: ['أوافق على عرض السعر رقم {num} بإجمالي {t}.', 'J\'accepte le devis n° {num} d\'un total de {t}.', '{num} numaralı {t} tutarındaki teklifi kabul ediyorum.'],
    vName: ['الاسم الكامل', 'Nom et prénom', 'Ad soyad'], vConfirm: ['تأكيد الموافقة', 'Confirmer l\'accord', 'Onayla'],
    vAccepted: ['تم القبول. ستتواصل معك الورشة.', 'Accord enregistré. L\'atelier vous recontactera.', 'Kabul edildi.'],
    vStatusAccepted: ['مقبول', 'Accepté', 'Kabul edildi'], vStatusCancelled: ['ملغى', 'Annulé', 'İptal'], vStatusReplaced: ['استُبدل بعرض أحدث', 'Remplacé', 'Değiştirildi'],
    vUntil: ['الرابط صالح حتى', 'Lien valable jusqu\'au', 'Geçerlilik'], vReadOnly: ['للعرض فقط: أدر الغرفة وافتح الأبواب كما تشاء، ولا يتغير شيء.', 'Consultation seule : tournez autour, ouvrez les portes, rien ne change.', 'Yalnızca görüntüleme.'],
    vHide: ['إخفاء', 'Masquer', 'Gizle'], vShow: ['التفاصيل', 'Détails', 'Ayrıntılar']
  };
  const L = () => { const l = window.I18N?.lang || 'ar'; return l === 'fr' ? 1 : l === 'tr' ? 2 : 0; };
  const t = (k, v = {}) => (W[k] ? W[k][L()] || W[k][0] : k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const dir = () => (L() === 0 ? 'rtl' : 'ltr');

  /* ---------- styles of everything this file adds, kept apart from the editor's ---------- */
  const CSS = `
.wc{font-family:var(--f-body,system-ui);color:#14191E;box-sizing:border-box}.wc *{box-sizing:border-box}
.wc-veil{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:16px;background:#14191E;background-image:radial-gradient(1200px 500px at 85% -10%,rgba(244,180,0,.20),transparent 60%),repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 64px)}
.wc-card{width:min(420px,100%);background:#fff;border-radius:14px;padding:26px 24px;box-shadow:0 30px 80px rgba(0,0,0,.45);border-top:6px solid #F4B400}
.wc-card h1{font-family:var(--f-display,inherit);font-size:24px;margin:0 0 4px}.wc-card .sub{color:#5A646C;font-size:13.5px;margin:0 0 18px;line-height:1.6}
.wc-f{display:block;margin:0 0 12px;font-size:13px;color:#3A434A}.wc-f input{display:block;width:100%;margin-top:5px;padding:11px 12px;border:1.5px solid #D5DADE;border-radius:9px;font:inherit;font-size:15px;background:#FAFBFC}
.wc-f input:focus{outline:none;border-color:#14191E;background:#fff}
.wc-b{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:9px;padding:11px 16px;font:inherit;font-weight:600;font-size:14px;cursor:pointer;background:#14191E;color:#fff}
.wc-b:disabled{opacity:.55;cursor:default}.wc-b.y{background:#F4B400;color:#14191E}.wc-b.g{background:#EEF1F3;color:#14191E}.wc-b.w{width:100%}
.wc-err{color:#B3261E;font-size:13px;min-height:18px;margin:4px 0 10px}.wc-ok{color:#1E6B3A;font-size:13.5px}
.wc-st{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(20,25,30,.14);background:#fff;border-radius:999px;padding:6px 11px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;color:#14191E}
.wc-st i{width:8px;height:8px;border-radius:50%;background:#1E9E55;flex:none}.wc-st[data-s=syncing] i{background:#F4B400;animation:wcp 1s infinite}.wc-st[data-s=waiting] i{background:#8A949B}
.wc-st[data-s=conflict] i,.wc-st[data-s=problem] i,.wc-st[data-s=signedOut] i{background:#D93025}@keyframes wcp{50%{opacity:.3}}
@media (max-width:760px){.wc-st span{display:none}.wc-st{padding:8px}}
.wc-sheet{position:fixed;inset:0;z-index:8000;background:rgba(10,12,14,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px}
.wc-sheet .wc-card{max-height:86vh;overflow:auto;width:min(520px,100%)}.wc-sheet h2{font-size:18px;margin:0 0 10px}
.wc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0 0}.wc-list{margin:8px 0 0;padding:0;list-style:none;font-size:13.5px}.wc-list li{padding:8px 0;border-top:1px solid #EEF1F3}
.wc-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13.5px}.wc-kv b{font-weight:600}
.wc-q{margin:12px 0 0;padding:12px;border:1.5px dashed #D5DADE;border-radius:10px;font-size:13.5px}.wc-q p{margin:6px 0 0;color:#5A646C;line-height:1.6}
.wc-link{display:flex;gap:6px;margin-top:8px}.wc-link input{flex:1;min-width:0;padding:9px;border:1.5px solid #D5DADE;border-radius:8px;font:12px var(--f-num,monospace);direction:ltr}
.wc-num{font-family:var(--f-num,monospace);direction:ltr;unicode-bidi:embed}
.wc-client{position:fixed;z-index:50;top:76px;inset-inline-end:16px;width:min(340px,calc(100vw - 32px));background:rgba(255,255,255,.96);backdrop-filter:blur(10px);border-radius:14px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,.25)}
.wc-client h3{margin:0 0 2px;font-size:16px}.wc-client .muted{color:#5A646C;font-size:12.5px;line-height:1.55}.wc-client .tot{display:flex;justify-content:space-between;align-items:baseline;margin:12px 0;padding:10px 0;border-block:1px solid #EEF1F3}
.wc-client .tot b{font-size:22px}.wc-client.min .body{display:none}.wc-client .tg{position:absolute;top:10px;inset-inline-end:12px;border:0;background:none;font:inherit;font-size:12px;color:#5A646C;cursor:pointer}
@media (max-width:760px){.wc-client{top:auto;bottom:74px;inset-inline-end:10px;padding:12px}}
body.wc-view #presExit,body.wc-view .pi-total,body.wc-view .pres-views [data-pv=shot]{display:none!important}
`;
  function addStyle(){ if ($('#wc-css')) return; const st = document.createElement('style'); st.id = 'wc-css'; st.textContent = CSS; document.head.appendChild(st); }

  /* ---------- server ---------- */
  const deviceName = () => lsGet('wr_cloud_device', '') || (/Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : 'PC');
  class Offline extends Error { constructor(){ super('offline'); this.offline = true; } }
  async function api(method, path, body, raw){
    const h = {'x-warsha': '1', 'x-warsha-device': deviceName().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60)};
    let b;
    if (raw) { b = raw; h['content-type'] = raw.type || 'application/pdf'; } else if (body !== undefined) { b = JSON.stringify(body); h['content-type'] = 'application/json'; }
    let r;
    try { r = await fetch('/api' + path, {method, headers: h, body: b, credentials: 'same-origin', cache: 'no-store'}); } catch { throw new Offline(); }
    if (r.status === 502 || r.status === 503 || r.status === 504) throw new Offline();
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.blob();
    return {status: r.status, ok: r.ok, data};
  }

  /* ---------- this device's copy: IndexedDB ---------- */
  let idb = null;
  function openIdb(){
    return new Promise((res, rej) => {
      const q = indexedDB.open('warsha-cloud', 1);
      q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('designs', {keyPath: 'id'}); d.createObjectStore('outbox', {keyPath: 'changeId'}); d.createObjectStore('kv'); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  const tx = (store, mode, fn) => new Promise((res, rej) => { const x = idb.transaction(store, mode); const s = x.objectStore(store); const out = fn(s); x.oncomplete = () => res(out?.result ?? out); x.onerror = () => rej(x.error); x.onabort = () => rej(x.error); });
  const all = store => new Promise((res, rej) => { const q = idb.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const kvGet = k => new Promise(res => { const q = idb.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
  const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));

  const S = {
    user: null, designs: new Map(), outbox: [], meta: {cursor: 0, settingsRev: 0, server: null},
    listeners: new Set(), status: 'waiting', lastSync: 0, busy: false, conflicts: [], notices: [], rejected: [], applying: false, staffLocal: false, stopped: false
  };
  let n0 = 0; const nextN = () => Date.now() * 1000 + (n0++ % 1000);

  function emit(){
    const docs = [...S.designs.values()].filter(r => !r.deleted).map(r => ({id: r.id, data: () => ({...r.data})}));
    for (const cb of S.listeners) { try { cb({docs}); } catch (e) { console.error(e); } }
  }
  const pendingFor = id => S.outbox.filter(o => o.id === id && (o.type === 'put' || o.type === 'del'));
  async function putRec(r){ S.designs.set(r.id, r); await tx('designs', 'readwrite', s => s.put(r)); }
  async function dropRec(id){ S.designs.delete(id); await tx('designs', 'readwrite', s => s.delete(id)); }
  async function addOp(op){ op.n = op.n || nextN(); S.outbox.push(op); S.outbox.sort((a, b) => a.n - b.n); await tx('outbox', 'readwrite', s => s.put(op)); }
  async function dropOp(op){ S.outbox = S.outbox.filter(o => o !== op && o.changeId !== op.changeId); await tx('outbox', 'readwrite', s => s.delete(op.changeId)); }
  async function saveMeta(){ await kvSet('meta', S.meta); }

  // the fields the server keeps, as the editor writes them
  const THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  function clean(d){
    const o = {name: String(d.name || '-').slice(0, 80), phone: String(d.phone || '').slice(0, 40), note: String(d.note || '').slice(0, 1000), cfg: d.cfg || {},
      thumb: typeof d.thumb === 'string' && THUMB.test(d.thumb) && d.thumb.length <= 600000 ? d.thumb : '', updatedAt: Math.max(0, Math.round(+d.updatedAt || Date.now()))};
    if (d.variant) o.variant = String(d.variant).slice(0, 8);
    return o;
  }
  const fromWire = p => clean({name: p.name, phone: p.phone, note: p.note, variant: p.variant, cfg: p.cfg, thumb: p.thumb, updatedAt: p.updatedAt});

  /* ---------- what the editor calls: db.collection('designs') ---------- */
  async function localPut(id, data){
    const r = S.designs.get(id) || {id, rev: 0};
    r.data = clean(data); r.deleted = false;
    await putRec(r);
    const q = S.outbox.find(o => o.id === id && o.type === 'put' && !o.inflight);
    if (q) { q.data = r.data; await tx('outbox', 'readwrite', s => s.delete(q.changeId)); q.changeId = 'c' + uid(); await tx('outbox', 'readwrite', s => s.put(q)); S.outbox.sort((a, b) => a.n - b.n); }
    else await addOp({changeId: 'c' + uid(), type: 'put', id, baseRev: r.rev, data: r.data});
    emit(); kick();
  }
  async function localDel(id){
    const r = S.designs.get(id); if (!r) return;
    // a design this server never had: nothing to send
    if (!r.rev) { for (const o of pendingFor(id)) if (!o.inflight) await dropOp(o); if (!pendingFor(id).length) { await dropRec(id); emit(); return; } }
    for (const o of pendingFor(id)) if (o.type === 'put' && !o.inflight) await dropOp(o);
    r.deleted = true; await putRec(r);
    await addOp({changeId: 'c' + uid(), type: 'del', id, baseRev: r.rev});
    emit(); kick();
  }
  const db = {
    collection(){ const c = {orderBy: () => c, limit: () => c,
      onSnapshot(cb){ S.listeners.add(cb); setTimeout(() => { try { emit(); } catch {} }, 0); return () => S.listeners.delete(cb); },
      doc: id => ({set: data => localPut(id, data), delete: () => localDel(id)})}; return c; }
  };

  /* ---------- settings: prices with the workshop identity, and fabrication settings ---------- */
  function onLocal(k, v){
    if (S.applying || MODE !== 'app' || !S.user || (k !== 'wr_prices' && k !== 'wr_fab')) return;
    if (S.user.role !== 'owner') { S.staffLocal = true; note(t('staffSettings')); render(); return; }
    clearTimeout(onLocal.t); onLocal.t = setTimeout(queueSettings, 900);
  }
  async function queueSettings(){
    const cur = window.WarshaHost?.settings(); if (!cur) return;
    const q = S.outbox.find(o => o.type === 'settings' && !o.inflight);
    if (q) { q.prices = cur.prices; q.fab = cur.fab; await tx('outbox', 'readwrite', s => s.put(q)); }
    else await addOp({changeId: 'c' + uid(), type: 'settings', baseRev: S.meta.settingsRev, prices: cur.prices, fab: cur.fab});
    lsPut('wr_cloud_set_pending', true); kick();
  }
  function applyServerSettings(s){
    S.meta.settingsRev = s.rev; S.meta.server = {prices: s.prices || {}, fab: s.fab || {}};
    lsPut('wr_cloud_settings', S.meta.server);
    S.applying = true;
    try { window.WarshaHost?.applySettings(S.meta.server.prices, S.meta.server.fab); } finally { S.applying = false; }
    S.staffLocal = false;
    if (!S.outbox.some(o => o.type === 'settings')) lsPut('wr_cloud_set_pending', false);
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function settingsDiffer(){
    if (S.outbox.some(o => o.type === 'settings') || S.staffLocal) return true;
    const sv = S.meta.server, cur = window.WarshaHost?.settings(); if (!cur) return true;
    // a quote freezes the server's settings: they must exist there and be the ones on screen
    if (!sv || !S.meta.settingsRev) return true;
    return Object.keys(sv.prices).some(k => !same(sv.prices[k], cur.prices[k])) || Object.keys(sv.fab).some(k => !same(sv.fab[k], cur.fab[k]));
  }

  /* ---------- the sync loop ---------- */
  let kickT = 0;
  function kick(ms = 300){ clearTimeout(kickT); kickT = setTimeout(syncOnce, ms); }
  let backoff = 2000;
  async function syncOnce(){
    if (S.busy || S.stopped || !S.user) return;
    S.busy = true; setStatus('syncing');
    try {
      await pull();
      await push();
      await pull();
      S.lastSync = Date.now(); backoff = 2000;
      setStatus(S.conflicts.length ? 'conflict' : S.rejected.length ? 'problem' : S.outbox.length ? 'waiting' : 'synced');
    } catch (e) {
      if (e.offline) { setStatus('waiting'); backoff = Math.min(backoff * 2, 60000); kick(backoff); }
      else if (e.auth) { setStatus('signedOut'); S.stopped = true; showLogin(true); }
      else { console.error(e); setStatus('problem'); kick(15000); }
    } finally { S.busy = false; }
  }
  async function pull(){
    for (let guard = 0; guard < 50; guard++) {
      const r = await api('GET', `/sync/changes?since=${S.meta.cursor}&limit=200`);
      if (r.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
      if (!r.ok) throw new Error('changes ' + r.status);
      let changed = false;
      for (const p of r.data.projects) {
        const local = S.designs.get(p.id), pend = pendingFor(p.id);
        if (pend.length) { if (local) { local.serverRev = p.rev; await putRec(local); } continue; }   // settled when our change is sent
        if (p.deleted) { if (local) { await dropRec(p.id); changed = true; } continue; }
        if (local && local.rev === p.rev && !local.deleted) continue;
        await putRec({id: p.id, rev: p.rev, data: fromWire(p), deleted: false}); changed = true;
      }
      if (r.data.settings && !S.outbox.some(o => o.type === 'settings') && r.data.settings.rev !== S.meta.settingsRev) applyServerSettings(r.data.settings);
      S.meta.cursor = r.data.cursor; await saveMeta();
      if (changed) { emit(); window.WarshaHost?.refreshClients(); }
      if (!r.data.more) break;
    }
  }
  async function push(){
    for (const op of [...S.outbox]) {
      if (!S.outbox.includes(op)) continue;
      op.inflight = true;
      try {
        if (op.type === 'put') await sendPut(op);
        else if (op.type === 'del') await sendDel(op);
        else if (op.type === 'settings') await sendSettings(op);
        else if (op.type === 'pdf') await sendPdf(op);
      } finally { op.inflight = false; }
    }
  }
  function check(r){
    if (r.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
    if (r.status === 429) { const e = new Offline(); throw e; }
  }
  async function reject(op, r){
    // kept, never thrown away: it can be downloaded from the status panel
    S.rejected.push({op, status: r.status, message: r.data?.message, at: Date.now()});
    await kvSet('rejected', S.rejected.map(x => ({...x, op: {...x.op, inflight: false}})));
    await dropOp(op);
  }
  async function sendPut(op){
    const r = await api('PUT', `/projects/${encodeURIComponent(op.id)}`, {baseRev: op.baseRev, changeId: op.changeId, data: op.data});
    check(r);
    if (r.ok) {
      await dropOp(op);
      const rec = S.designs.get(op.id); if (rec) { rec.rev = r.data.rev; delete rec.serverRev; await putRec(rec); }
      for (const o of S.outbox) if (o.id === op.id && o !== op) { o.baseRev = r.data.rev; await tx('outbox', 'readwrite', s => s.put(o)); }
      return;
    }
    if (r.status === 409) return conflictPut(op, r.data.server);
    return reject(op, r);
  }
  async function conflictPut(op, server){
    const mine = op.data, copyId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await dropOp(op);
    if (server && !server.deleted) await putRec({id: op.id, rev: server.rev, data: fromWire(server), deleted: false});
    else if (server) await putRec({id: op.id, rev: server.rev, data: fromWire(server), deleted: true});
    else await dropRec(op.id);
    const copy = {...mine, variant: 'تعارض', updatedAt: Date.now()};
    await putRec({id: copyId, rev: 0, data: copy, deleted: false});
    await addOp({changeId: 'c' + uid(), type: 'put', id: copyId, baseRev: 0, data: copy});
    S.conflicts.push({kind: 'design', id: op.id, copyId, name: mine.name, at: Date.now(), gone: !server || server.deleted});
    await kvSet('conflicts', S.conflicts); emit(); window.WarshaHost?.refreshClients(); showConflicts();
  }
  async function sendDel(op){
    const r = await api('POST', `/projects/${encodeURIComponent(op.id)}/delete`, {baseRev: op.baseRev, changeId: op.changeId});
    check(r);
    if (r.ok || r.status === 404) { await dropOp(op); await dropRec(op.id); return; }
    if (r.status === 409) {
      await dropOp(op); const s = r.data.server;
      if (s && !s.deleted) await putRec({id: op.id, rev: s.rev, data: fromWire(s), deleted: false}); else await dropRec(op.id);
      note(t('delConflict', {n: s?.name || op.id})); emit(); window.WarshaHost?.refreshClients(); return;
    }
    return reject(op, r);
  }
  async function sendSettings(op){
    const r = await api('PUT', '/settings', {baseRev: op.baseRev, changeId: op.changeId, prices: op.prices, fab: op.fab});
    check(r);
    if (r.ok) { await dropOp(op); S.meta.settingsRev = r.data.rev; S.meta.server = {prices: op.prices, fab: op.fab}; lsPut('wr_cloud_settings', S.meta.server); if (!S.outbox.some(o => o.type === 'settings')) lsPut('wr_cloud_set_pending', false); await saveMeta(); return; }
    if (r.status === 409) {
      await dropOp(op);
      S.conflicts.push({kind: 'settings', mine: {prices: op.prices, fab: op.fab}, server: r.data.server, at: Date.now()});
      await kvSet('conflicts', S.conflicts); showConflicts(); return;
    }
    if (r.status === 403) { await dropOp(op); S.staffLocal = true; note(t('staffSettings')); return; }
    return reject(op, r);
  }
  async function sendPdf(op){
    const r = await api('PUT', `/quotes/${op.quoteId}/pdf`, undefined, op.blob);
    check(r);
    if (r.ok) { await dropOp(op); note(t('issued', {num: op.number})); return; }
    return reject(op, r);
  }

  /* ---------- conflicts: both versions are kept until someone chooses ---------- */
  async function resolve(i, choice){
    const c = S.conflicts[i]; if (!c) return;
    if (c.kind === 'design') {
      const copy = S.designs.get(c.copyId), orig = S.designs.get(c.id);
      if (choice === 'mine' && copy) {
        const data = {...copy.data}; delete data.variant;
        const o0 = S.designs.get(c.id) || {id: c.id, rev: orig?.rev || 0};
        o0.data = clean(data); o0.deleted = false; await putRec(o0);
        await addOp({changeId: 'c' + uid(), type: 'put', id: c.id, baseRev: orig?.rev || 0, data: o0.data});
        await localDel(c.copyId);
      } else if (choice === 'theirs' && copy) await localDel(c.copyId);
    } else if (c.kind === 'settings') {
      if (choice === 'mine') { S.meta.settingsRev = c.server.rev; await addOp({changeId: 'c' + uid(), type: 'settings', baseRev: c.server.rev, prices: c.mine.prices, fab: c.mine.fab}); }
      else applyServerSettings(c.server);
      await saveMeta();
    }
    S.conflicts.splice(i, 1); await kvSet('conflicts', S.conflicts);
    emit(); window.WarshaHost?.refreshClients(); kick(); render();
  }

  /* ---------- the status button and its panel ---------- */
  function setStatus(s){ S.status = s; render(); }
  function note(m){ try { window.WarshaHost?.toast(m); } catch {} S.notices.unshift({m, at: Date.now()}); S.notices.length = Math.min(S.notices.length, 8); }
  function render(){
    const b = $('#wcStatus'); if (!b) return;
    const n = S.outbox.length, s = S.status;
    b.dataset.s = s; b.innerHTML = `<i></i><span>${esc(t(s))}${n && s !== 'synced' ? ` <b class="wc-num">${n}</b>` : ''}</span>`;
    b.title = t(s) + (n ? ` (${n} ${t('pending')})` : '');
  }
  function mountStatus(){
    if ($('#wcStatus')) return;
    const bar = $('.bar'), save = $('#saveBtn'); if (!bar || !save) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wc wc-st'; b.id = 'wcStatus'; b.setAttribute('data-notr', '');
    b.onclick = showPanel; bar.insertBefore(b, save); render();
  }
  function sheet(html, onClick){
    closeSheet();
    const d = document.createElement('div'); d.className = 'wc wc-sheet'; d.id = 'wcSheet'; d.dir = dir(); d.setAttribute('data-notr', '');
    d.innerHTML = `<div class="wc-card" role="dialog">${html}</div>`;
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-x]')) return closeSheet(); onClick?.(e); });
    document.body.appendChild(d); return d;
  }
  const closeSheet = () => $('#wcSheet')?.remove();
  function showPanel(){
    const u = S.user, n = S.outbox.length;
    const d = sheet(`<h2>${esc(t(S.status))}</h2>
      <div class="wc-kv"><span>${esc(u?.name || '')}</span><b class="wc-num">${esc(u?.email || '')}</b>
      <span>${t('lastSync')}</span><b>${S.lastSync ? new Date(S.lastSync).toLocaleString() : '-'}</b>
      <span>${t('pending')}</span><b class="wc-num">${n}</b></div>
      <label class="wc-f" style="margin-top:12px">${t('device')}<input id="wcDev" value="${esc(deviceName())}" maxlength="40"></label>
      ${S.conflicts.length ? `<ul class="wc-list">${S.conflicts.map((c, i) => `<li>${esc(c.kind === 'settings' ? t('setConflict') : t('conflictText', {n: c.name}))}<div class="wc-row"><button class="wc-b g" data-r="${i}:both">${t('keepBoth')}</button><button class="wc-b g" data-r="${i}:mine">${t('keepMine')}</button><button class="wc-b g" data-r="${i}:theirs">${t('keepTheirs')}</button></div></li>`).join('')}</ul>` : ''}
      ${S.rejected.length ? `<ul class="wc-list">${S.rejected.map((x, i) => `<li>${t('rejected')} (${x.status}) ${esc(x.op?.data?.name || x.op?.type || '')} <button class="wc-b g" data-rej="${i}">${t('download')}</button></li>`).join('')}</ul>` : ''}
      ${S.notices.length ? `<ul class="wc-list">${S.notices.map(x => `<li>${esc(x.m)}</li>`).join('')}</ul>` : ''}
      <div class="wc-row"><button class="wc-b" data-a="sync">${t('syncNow')}</button><a class="wc-b g" href="/admin" target="_blank" rel="noopener">${t('admin')}</a><button class="wc-b g" data-a="out">${t('signOut')}</button><button class="wc-b g" data-x>${t('close')}</button></div>
      <p class="wc-err" id="wcPanelErr"></p>`, async e => {
      const r = e.target.closest('[data-r]'); if (r) { const [i, c] = r.dataset.r.split(':'); if (c === 'both') { S.conflicts.splice(+i, 1); await kvSet('conflicts', S.conflicts); render(); showPanel(); } else { await resolve(+i, c); showPanel(); } return; }
      const rj = e.target.closest('[data-rej]'); if (rj) { const x = S.rejected[+rj.dataset.rej]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(x, null, 1)], {type: 'application/json'})); a.download = 'warsha-change.json'; a.click(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'sync') { S.stopped = false; kick(0); closeSheet(); }
      if (a === 'out') {
        if (S.outbox.length && !d.dataset.armed) { d.dataset.armed = '1'; $('#wcPanelErr').textContent = t('signOutPending'); return; }
        await api('POST', '/auth/logout', {}).catch(() => {});
        S.user = null; S.stopped = true; await kvSet('user', null); location.reload();
      }
    });
    d.querySelector('#wcDev').addEventListener('change', e => { lsPut('wr_cloud_device', e.target.value.trim().slice(0, 40)); });
  }
  function showConflicts(){ if (MODE === 'app') { render(); showPanel(); } }

  /* ---------- sign in ---------- */
  let loginResolve = null;
  function showLogin(again){
    if ($('#wcLogin')) return;
    const v = document.createElement('div'); v.className = 'wc wc-veil'; v.id = 'wcLogin'; v.dir = dir(); v.setAttribute('data-notr', '');
    v.innerHTML = `<form class="wc-card" id="wcLoginF" autocomplete="on"><h1>${t('signIn')}</h1><p class="sub">${esc(again ? t('signedOut') : '')}</p>
      <label class="wc-f">${t('email')}<input name="email" type="email" autocomplete="username" required dir="ltr"></label>
      <label class="wc-f">${t('password')}<input name="password" type="password" autocomplete="current-password" required dir="ltr"></label>
      <p class="wc-err" id="wcLoginErr"></p><button class="wc-b y w">${t('enter')}</button></form>`;
    document.body.appendChild(v); setTimeout(() => v.querySelector('input')?.focus(), 50);
    v.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const f = new FormData(e.target), btn = e.target.querySelector('button'), err = $('#wcLoginErr');
      btn.disabled = true; err.textContent = '';
      try {
        const r = await api('POST', '/auth/login', {email: String(f.get('email')), password: String(f.get('password'))});
        if (r.ok) { v.remove(); await signedIn(r.data.user); return; }
        err.textContent = r.status === 429 ? t('tooMany') : /locked/.test(r.data?.message || '') ? t('locked') : t('wrong');
      } catch { err.textContent = t('offlineNoCache'); }
      btn.disabled = false;
    });
  }
  function showSetup(){
    const v = document.createElement('div'); v.className = 'wc wc-veil'; v.id = 'wcLogin'; v.dir = dir(); v.setAttribute('data-notr', '');
    v.innerHTML = `<form class="wc-card"><h1>${t('setupTitle')}</h1><p class="sub">${t('setupHint')}</p>
      <label class="wc-f">${t('setupToken')}<input name="token" required dir="ltr" autocomplete="off"></label>
      <label class="wc-f">${t('yourName')}<input name="name" required maxlength="80"></label>
      <label class="wc-f">${t('email')}<input name="email" type="email" required dir="ltr" autocomplete="username"></label>
      <label class="wc-f">${t('password')}<input name="password" type="password" required dir="ltr" autocomplete="new-password"></label>
      <label class="wc-f">${t('pass2')}<input name="password2" type="password" required dir="ltr" autocomplete="new-password"></label>
      <p class="wc-err"></p><button class="wc-b y w">${t('create')}</button></form>`;
    document.body.appendChild(v);
    v.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), err = v.querySelector('.wc-err');
      if (String(f.password).length < 10) { err.textContent = t('passShort'); return; }
      if (f.password !== f.password2) { err.textContent = t('passDiff'); return; }
      const r = await api('POST', '/auth/setup', {token: f.token.trim(), name: f.name.trim(), email: f.email.trim(), password: f.password}).catch(() => null);
      if (r?.ok) { v.remove(); await signedIn(r.data.user); return; }
      err.textContent = r?.status === 403 ? t('badToken') : r ? (r.data?.message || 'error') : t('offlineNoCache');
    });
  }
  async function signedIn(user){
    const prev = await kvGet('user');
    // another account of the same workshop on this device: the cache is the workshop's, the outbox stays as it is
    S.user = user; await kvSet('user', user); S.stopped = false;
    if (prev && prev.id !== user.id) { S.meta.cursor = 0; await saveMeta(); }
    loginResolve?.(); loginResolve = null;
    mountStatus(); render(); kick(0);
    if (!S.meta.migrated) migrate();
  }

  // first time on this device: designs kept in this browser before the server are sent to it (and stay here too)
  async function migrate(){
    S.meta.migrated = true; await saveMeta();
    const old = lsGet('wr_designs', []);
    for (const d of Array.isArray(old) ? old : []) {
      if (!d || typeof d.id !== 'string' || !/^[\w-]{3,40}$/.test(d.id) || !d.cfg || S.designs.has(d.id)) continue;
      const rec = {id: d.id, rev: 0, data: clean(d), deleted: false};
      await putRec(rec); await addOp({changeId: 'c' + uid(), type: 'put', id: d.id, baseRev: 0, data: rec.data});
    }
    // the owner's first device gives the workshop its prices when the server has none yet
    if (S.user?.role === 'owner') setTimeout(() => { if (S.meta.settingsRev === 0 && !S.meta.server && !S.outbox.some(o => o.type === 'settings')) queueSettings(); }, 4000);
    emit(); kick();
  }

  /* ---------- quotes from the document sheet ---------- */
  function onDoc(kind){
    if (MODE !== 'app') return;
    let box = $('#wcQuote'); const host = $('#docSheet .body');
    if (kind !== 'quote') { box?.remove(); return; }
    if (!host) return;
    if (!box) { box = document.createElement('div'); box.id = 'wcQuote'; box.className = 'wc wc-q'; box.setAttribute('data-notr', ''); host.appendChild(box); }
    box.dir = dir();
    box.innerHTML = `<button type="button" class="wc-b y" id="wcIssue">${t('issueBtn')}</button><p>${t('issueHint')}</p><p class="wc-err" id="wcQErr"></p><div id="wcQOut"></div>`;
    $('#wcIssue').onclick = issue;
  }
  async function flushFor(id){
    kick(0);
    for (let i = 0; i < 60; i++) {
      await wait(250);
      if (!S.busy && !pendingFor(id).length && !S.outbox.some(o => o.type === 'settings')) { if (S.status === 'waiting' && S.outbox.length) return false; return true; }
      if (S.status === 'waiting' && !S.busy) return false;
    }
    return false;
  }
  async function issue(){
    const H = window.WarshaHost, err = $('#wcQErr'), btn = $('#wcIssue'); err.textContent = '';
    const cur = H.current();
    if (!cur) { err.textContent = t('needClient'); return; }
    if (!cur.saved) { err.textContent = t('needSave'); return; }
    btn.disabled = true; btn.textContent = t('issuing');
    try {
      if (S.user?.role === 'owner' && !S.meta.settingsRev && !S.outbox.some(o => o.type === 'settings')) await queueSettings();
      if (!(await flushFor(cur.id))) { err.textContent = t('needNet'); return; }
      const rec = S.designs.get(cur.id);
      if (!rec?.rev) { err.textContent = t('needNet'); return; }
      if (settingsDiffer()) { err.textContent = t('pricesDiffer'); return; }
      const fig = H.figures();
      const r = await api('POST', '/quotes/reserve', {projectId: cur.id, projectRev: rec.rev, settingsRev: S.meta.settingsRev, figures: fig, currency: String(fig.cur || '').slice(0, 12), total: String(Math.round(fig.total * 100) / 100)});
      if (!r.ok) { err.textContent = r.data?.code === 'settings_changed' ? t('pricesDiffer') : r.data?.code === 'project_changed' || r.data?.code === 'not_synced' ? t('projChanged') : t('issueFail') + ` (${r.status})`; kick(0); return; }
      const q = r.data, doc = await H.issueQuote(q.number);
      let up = null; try { up = await api('PUT', `/quotes/${q.id}/pdf`, undefined, doc.blob); } catch {}
      if (!up?.ok) { await addOp({changeId: 'c' + uid(), type: 'pdf', quoteId: q.id, number: q.number, blob: doc.blob}); $('#wcQOut').innerHTML = `<p class="wc-ok">${esc(t('pdfLater', {num: q.number}))}</p>`; kick(5000); }
      else { $('#wcQOut').innerHTML = `<p class="wc-ok">${esc(t('issued', {num: q.number}))} <span class="wc-num">SHA-256 ${esc(up.data.sha256.slice(0, 16))}…</span></p>${linkForm(cur.id, q.id)}`; bindLink(cur.id, q.id); }
      btn.hidden = true;
    } catch (e) { console.error(e); err.textContent = e.offline ? t('needNet') : t('issueFail'); }
    finally { btn.disabled = false; if (!btn.hidden) btn.textContent = t('issueBtn'); }
  }
  const linkForm = () => `<div class="wc-row"><label class="wc-f" style="margin:0">${t('linkDays')} <input id="wcLDays" type="number" min="1" max="180" value="30" style="width:80px;display:inline-block"> ${t('days')}</label>
    <label class="wc-f" style="margin:0;flex:1">${t('linkPin')}<input id="wcLPin" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" dir="ltr"></label></div>
    <div class="wc-row"><button type="button" class="wc-b" id="wcLGo">${t('makeLink')}</button></div><div id="wcLOut"></div>`;
  function bindLink(projectId, quoteId){
    $('#wcLGo').onclick = async () => {
      const pin = $('#wcLPin').value.trim(), days = Math.max(1, Math.min(180, +$('#wcLDays').value || 30));
      const r = await api('POST', '/share', {projectId, ...(quoteId ? {quoteId} : {}), days, ...(pin ? {pin} : {})}).catch(() => null);
      if (!r?.ok) { $('#wcLOut').innerHTML = `<p class="wc-err">${esc(r?.data?.message || t('needNet'))}</p>`; return; }
      $('#wcLOut').innerHTML = `<div class="wc-link"><input readonly value="${esc(r.data.url)}" id="wcLUrl"><button type="button" class="wc-b g" id="wcLCopy">${t('copy')}</button><a class="wc-b g" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(r.data.url)}">${t('whatsapp')}</a></div><p>${t('linkMade')}</p>`;
      $('#wcLCopy').onclick = async () => { try { await navigator.clipboard.writeText(r.data.url); $('#wcLCopy').textContent = t('copied'); } catch { $('#wcLUrl').select(); } };
    };
  }

  /* ---------- the assistant through the server (only when enabled there) ---------- */
  async function sample(){
    if (MODE !== 'app') return null;
    await dbPromise;
    const r = await api('GET', '/ai/limits').catch(() => null);
    if (!r?.ok || !r.data.enabled) return null;
    const toUrl = b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
    const call = async (prompt, opts = {}) => {
      const images = opts.images?.length ? [await toUrl(opts.images[0])] : undefined;
      const x = await api('POST', '/ai/sample', {prompt: String(prompt), ...(images ? {images} : {}), ...(opts.modelTier ? {modelTier: opts.modelTier} : {})});
      if (!x.ok) throw {code: x.status === 429 ? 'rate_limited' : 'failed', message: x.data?.message};
      return x.data;
    };
    const fn = (input, opts) => call(typeof input === 'string' ? input : input.map(m => m.content).join('\n\n'), opts);
    fn.limits = async () => ({images: r.data.images});
    fn.json = async (prompt, opts) => { const x = await call(prompt + '\n\nReply with JSON only.', opts); const m = /\{[\s\S]*\}/.exec(x.text); if (!m) throw {code: 'invalid_json'}; return JSON.parse(m[0]); };
    return fn;
  }

  /* ---------- the client's read only view: /v/<token> ---------- */
  async function view(){
    document.body.classList.add('wc-view');
    const token = location.pathname.split('/').pop();
    const veil = document.createElement('div'); veil.className = 'wc wc-veil'; veil.id = 'wcLogin'; veil.dir = dir(); veil.setAttribute('data-notr', '');
    veil.innerHTML = `<div class="wc-card"><h1>${t('vLoading')}</h1></div>`; document.body.appendChild(veil);
    let pin = '';
    const open = async () => {
      let r; try { r = await api('POST', `/public/share/${token}`, pin ? {pin} : {}); } catch { veil.innerHTML = `<div class="wc-card"><h1>${t('offlineNoCache')}</h1></div>`; return; }
      if (r.status === 410) { veil.innerHTML = `<div class="wc-card"><h1>${t('vEnded')}</h1></div>`; return; }
      if (r.status === 404) { veil.innerHTML = `<div class="wc-card"><h1>${t('vNotFound')}</h1></div>`; return; }
      if (r.status === 403 || r.data?.pinRequired) {
        veil.innerHTML = `<form class="wc-card"><h1>${t('vPinTitle')}</h1><label class="wc-f"><input name="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="8" dir="ltr" required></label><p class="wc-err">${r.status === 403 ? t('vPinWrong') : ''}</p><button class="wc-b y w">${t('vOpen')}</button></form>`;
        veil.querySelector('input').focus();
        veil.querySelector('form').onsubmit = e => { e.preventDefault(); pin = new FormData(e.target).get('pin').trim(); open(); };
        return;
      }
      if (!r.ok) { veil.innerHTML = `<div class="wc-card"><h1>${t('vNotFound')}</h1></div>`; return; }
      veil.remove(); show(r.data);
    };
    const show = data => {
      const H = window.WarshaHost; H.readOnly();
      S.applying = true; try { H.applySettings({...data.shop, cur: data.quote?.currency || data.shop.cur}, null); } finally { S.applying = false; }
      H.openDesign({name: data.design.name, cfg: data.design.cfg}, {id: '', name: data.design.name, phone: '', note: ''});
      H.present(true);
      new MutationObserver(() => { if (!document.body.classList.contains('present')) H.present(true); }).observe(document.body, {attributes: true, attributeFilter: ['class']});
      const q = data.quote, money = v => { try { return H.money(+v); } catch { return v; } };
      const card = document.createElement('aside'); card.className = 'wc wc-client'; card.dir = dir(); card.setAttribute('data-notr', '');
      const st = q?.status === 'accepted' ? t('vStatusAccepted') : q?.status === 'cancelled' ? t('vStatusCancelled') : q?.status === 'replaced' ? t('vStatusReplaced') : '';
      card.innerHTML = `<button class="tg" type="button">${t('vHide')}</button><h3>${esc(data.shop.shop || '')}</h3><div class="muted">${esc(data.design.name)}${data.design.variant ? ' ' + esc(data.design.variant) : ''}</div>
        <div class="body">${q ? `<div class="tot"><span>${t('vQuote')} <span class="wc-num">${esc(q.number)}</span></span><b class="wc-num">${esc(money(q.total))}</b></div>
          ${st ? `<p class="wc-ok">${esc(st)}</p>` : ''}
          <div class="wc-row"><button class="wc-b g" type="button" data-v="pdf">${t('vPdf')}</button>${q.status === 'sent' ? `<button class="wc-b y" type="button" data-v="acc">${t('vAccept')}</button>` : ''}</div><div id="wcAcc"></div>` : ''}
          <p class="muted">${t('vReadOnly')}</p><p class="muted">${t('vUntil')} ${new Date(data.expiresAt).toLocaleDateString()}</p>
          ${[data.shop.shopPhone, data.shop.shopEmail].filter(Boolean).map(x => `<div class="muted wc-num">${esc(x)}</div>`).join('')}</div>`;
      document.body.appendChild(card);
      card.querySelector('.tg').onclick = () => { card.classList.toggle('min'); card.querySelector('.tg').textContent = card.classList.contains('min') ? t('vShow') : t('vHide'); };
      card.addEventListener('click', async e => {
        const v = e.target.closest('[data-v]')?.dataset.v;
        if (v === 'pdf') {
          const r = await api('POST', `/public/share/${token}/pdf`, pin ? {pin} : {}).catch(() => null);
          if (r?.ok) { const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `${q.number}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
        }
        if (v === 'acc') {
          $('#wcAcc').innerHTML = `<form><p>${esc(t('vAcceptText', {num: q.number, t: money(q.total)}))}</p><label class="wc-f">${t('vName')}<input name="name" required minlength="2" maxlength="80"></label><p class="wc-err"></p><button class="wc-b y w">${t('vConfirm')}</button></form>`;
          $('#wcAcc form').onsubmit = async ev => {
            ev.preventDefault(); const name = new FormData(ev.target).get('name').trim(), er = $('#wcAcc .wc-err');
            const r = await api('POST', `/public/share/${token}/accept`, {name, ...(pin ? {pin} : {})}).catch(() => null);
            if (r?.ok) { $('#wcAcc').innerHTML = `<p class="wc-ok">${t('vAccepted')}</p>`; card.querySelector('[data-v=acc]')?.remove(); }
            else er.textContent = r?.data?.message || t('offlineNoCache');
          };
        }
      });
    };
    // Escape would leave the presentation: not in the client's view
    addEventListener('keydown', e => { if (e.key === 'Escape') e.stopImmediatePropagation(); }, true);
    open();
  }

  /* ---------- start ---------- */
  let dbReady;
  const dbPromise = new Promise(r => { dbReady = r; });
  async function boot(){
    addStyle();
    if (MODE === 'view') { (document.readyState === 'loading' ? new Promise(r => addEventListener('DOMContentLoaded', r)) : Promise.resolve()).then(() => setTimeout(view, 0)); dbReady(null); return; }
    try { idb = await openIdb(); } catch (e) { console.error('IndexedDB unavailable', e); }
    if (idb) {
      for (const r of await all('designs')) S.designs.set(r.id, r);
      S.outbox = (await all('outbox')).map(o => ({...o, inflight: false})).sort((a, b) => a.n - b.n);
      S.meta = {...S.meta, ...(await kvGet('meta') || {})};
      S.conflicts = (await kvGet('conflicts')) || []; S.rejected = (await kvGet('rejected')) || [];
    }
    let state = null;
    try { const r = await api('GET', '/auth/state'); if (r.ok) state = r.data; } catch {}
    const cached = idb ? await kvGet('user') : null;
    await domReady;
    if (state?.setupNeeded) { showSetup(); await new Promise(r => { loginResolve = r; }); }
    else if (state?.user) await signedIn(state.user);
    else if (!state && cached) { S.user = cached; mountStatus(); setStatus('waiting'); kick(3000); }  // no network: work from this device's copy
    else { showLogin(false); await new Promise(r => { loginResolve = r; }); }
    dbReady(idb ? db : null);
    try { navigator.serviceWorker?.register('/sw.js', {scope: '/'}).catch(() => {}); } catch {}
    setInterval(() => { if (!document.hidden) kick(0); }, 20000);
    addEventListener('online', () => { S.stopped = false; kick(0); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(0); });
    window.addEventListener('beforeunload', e => { if (S.outbox.some(o => o.inflight)) { e.preventDefault(); e.returnValue = ''; } });
  }
  const domReady = document.readyState === 'loading' ? new Promise(r => addEventListener('DOMContentLoaded', r)) : Promise.resolve();
  // the editor reads its prices at start: give it the workshop's last known settings at once
  // (not when this device has settings changes still waiting for the server: those stay)
  if (MODE === 'app' && !lsGet('wr_cloud_set_pending', false)) { const sv = lsGet('wr_cloud_settings', null); if (sv && sv.prices) { lsPut('wr_prices', sv.prices); lsPut('wr_fab', sv.fab || {}); } }
  if (MODE === 'app') document.addEventListener('change', e => { if (e.target?.id === 'langSel') setTimeout(render, 50); });

  window.WarshaCloud = {db: () => dbPromise, onLocal, onDoc, sample, get state(){ return {status: S.status, pending: S.outbox.length, conflicts: S.conflicts.length, user: S.user}; }, _sync: () => syncOnce(), _S: S};
  boot();
})();
