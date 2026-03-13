// ===== PIN & KULLANICI SİSTEMİ =====
const KASA_USERS = [
  { id: 'u1', ad: 'Mustafa' },
  { id: 'u2', ad: 'Fatih' },
];

let kasaCurrentUser = null;

function kasaSelectUser(userId) {
  const user = KASA_USERS.find(u => u.id === userId);
  if (!user) return;
  kasaCurrentUser = user;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('navUser').textContent = '👤 ' + user.ad;
  load();
  init();
  const tryFb = () => { if (window._fb !== undefined) listenFirebase(); else setTimeout(tryFb, 200); };
  tryFb();
  fetchKurlar();
}

// Çıkış
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('navUser').addEventListener('click', () => {
    if (!kasaCurrentUser) return;
    if (!confirm(kasaCurrentUser.ad + ' olarak çıkış yapılsın mı?')) return;
    kasaCurrentUser = null;
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('navUser').textContent = '👤 —';
  });
});

// ===== STATE =====
let state = {
  kasa: [], toptancilar: [], toptanciIslemler: [], giderler: [],
  ortaklar: [
    { id: 'o1', ad: 'Mustafa' },
    { id: 'o2', ad: 'Fatih' }
  ],
  ortakIslemler: [],
  gecmisBorc: [],
  toptanciEskiBorc: []
};
let kurlar = { USD: 0, EUR: 0, GBP: 0, RUB: 0, updated: null };
let _saveTimeout = null;

// ===== STORAGE (Firebase + localStorage fallback) =====
function getDB() { return window._fb && window._fb.db ? window._fb.db : null; }

function showSyncStatus(status) {
  let el = document.getElementById('syncStatus');
  if (!el) return;
  if (status === 'saving') { el.textContent = '⏳ Kaydediliyor...'; el.style.color = 'var(--yellow)'; }
  else if (status === 'saved') { el.textContent = '✅ Kaydedildi'; el.style.color = 'var(--green)'; }
  else if (status === 'offline') { el.textContent = '📴 Çevrimdışı (yerel)'; el.style.color = 'var(--red)'; }
  else if (status === 'live') { el.textContent = '🔴 Canlı'; el.style.color = 'var(--green)'; }
}

function save() {
  // Debounce: çok sık kayıt yapmamak için
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(async () => {
    const db = getDB();
    if (!db) {
      localStorage.setItem('isletme_kasa_v1', JSON.stringify(state));
      return;
    }
    showSyncStatus('saving');
    try {
      const { doc, setDoc, collection } = window._fb;
      await setDoc(doc(collection(db, 'isletme_kasa'), 'state'), JSON.parse(JSON.stringify(state)));
      showSyncStatus('saved');
      setTimeout(() => showSyncStatus('live'), 2000);
    } catch(e) {
      console.error('Firebase kayıt hatası:', e);
      localStorage.setItem('isletme_kasa_v1', JSON.stringify(state));
      showSyncStatus('offline');
    }
  }, 600);
}

function load() {
  // localStorage fallback
  const d = localStorage.getItem('isletme_kasa_v1');
  if (d) { try { state = JSON.parse(d); } catch(e) {} }
  const k = localStorage.getItem('isletme_kurlar');
  if (k) { try { kurlar = JSON.parse(k); } catch(e) {} }
}

function saveKurlar() {
  localStorage.setItem('isletme_kurlar', JSON.stringify(kurlar));
}

function listenFirebase() {
  const db = getDB();
  if (!db) {
    // Firebase yoksa biraz bekle, tekrar dene
    setTimeout(() => {
      if (getDB()) listenFirebase();
      else showSyncStatus('offline');
    }, 1000);
    return;
  }
  const { doc, onSnapshot, collection, query, orderBy } = window._fb;

  // Kasa state dinle
  onSnapshot(doc(collection(db, 'isletme_kasa'), 'state'), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      if (data.kasa) state.kasa = data.kasa;
      if (data.toptancilar) state.toptancilar = data.toptancilar;
      if (data.toptanciIslemler) state.toptanciIslemler = data.toptanciIslemler;
      if (data.giderler) state.giderler = data.giderler;
      if (data.ortaklar) state.ortaklar = data.ortaklar;
      if (data.ortakIslemler) state.ortakIslemler = data.ortakIslemler;
      if (data.gecmisBorc) state.gecmisBorc = data.gecmisBorc;
      if (data.toptanciEskiBorc) state.toptanciEskiBorc = data.toptanciEskiBorc;
      renderKasa(); renderStats(); renderToptanciKartlar();
      renderToptanciIslemler(); renderToptanciFilter();
      renderGider(); renderGiderStats();
      renderOrtakFilter(); renderOrtakSayfasi(); renderOzet();
    }
    showSyncStatus('live');
  }, (err) => {
    console.warn('Firestore dinleme hatası:', err);
    showSyncStatus('offline');
  });

  // Satışlar koleksiyonunu dinle
  onSnapshot(query(collection(db, 'satislar'), orderBy('id', 'desc')), (snap) => {
    satislarCache = snap.docs.map(d => d.data());
    renderKasaSatislar();
    renderStats();
    renderOzet();
  });
}

// ===== KURLAR =====
async function fetchKurlar() {
  document.getElementById('kurUpdateTime').textContent = 'Kurlar yükleniyor...';

  // Timeout helper
  const fetchWithTimeout = (url, ms=7000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  // ---- KAYNAK 1: TCMB via allorigins proxy ----
  try {
    const tcmbUrl = 'https://www.tcmb.gov.tr/kurlar/today.xml';
    const res = await fetchWithTimeout('https://api.allorigins.win/get?url=' + encodeURIComponent(tcmbUrl));
    if (res.ok) {
      const json = await res.json();
      const doc = new DOMParser().parseFromString(json.contents, 'text/xml');
      const getRate = (kod) => {
        for (const node of doc.querySelectorAll('Currency')) {
          if (node.getAttribute('Kod') === kod) {
            const unit = parseInt(node.querySelector('Unit')?.textContent || '1');
            const val = node.querySelector('ForexBuying')?.textContent?.trim() ||
                        node.querySelector('ForexSelling')?.textContent?.trim();
            return val ? parseFloat(val.replace(',', '.')) / unit : 0;
          }
        }
        return 0;
      };
      const usd = getRate('USD'), eur = getRate('EUR'), gbp = getRate('GBP'), rub = getRate('RUB');
      if (usd > 1) {
        kurlar.USD = usd; kurlar.EUR = eur; kurlar.GBP = gbp; kurlar.RUB = rub;
        kurlar.updated = new Date().toLocaleTimeString('tr-TR') + ' · TCMB';
        saveKurlar(); renderKurBar(); updateKasaKur(); updateOrtakKur(); renderStats();
        document.getElementById('kurUpdateTime').textContent = 'Son güncelleme: ' + kurlar.updated;
        showToast('TCMB kurları güncellendi ✓');
        return;
      }
    }
  } catch(e) { console.warn('TCMB kaynak 1 başarısız:', e.message); }

  // ---- KAYNAK 2: corsproxy.io + TCMB ----
  try {
    const res = await fetchWithTimeout('https://corsproxy.io/?' + encodeURIComponent('https://www.tcmb.gov.tr/kurlar/today.xml'));
    if (res.ok) {
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const getRate = (kod) => {
        for (const node of doc.querySelectorAll('Currency')) {
          if (node.getAttribute('Kod') === kod) {
            const unit = parseInt(node.querySelector('Unit')?.textContent || '1');
            const val = node.querySelector('ForexBuying')?.textContent?.trim() ||
                        node.querySelector('ForexSelling')?.textContent?.trim();
            return val ? parseFloat(val.replace(',', '.')) / unit : 0;
          }
        }
        return 0;
      };
      const usd = getRate('USD'), eur = getRate('EUR'), gbp = getRate('GBP'), rub = getRate('RUB');
      if (usd > 1) {
        kurlar.USD = usd; kurlar.EUR = eur; kurlar.GBP = gbp; kurlar.RUB = rub;
        kurlar.updated = new Date().toLocaleTimeString('tr-TR') + ' · TCMB';
        saveKurlar(); renderKurBar(); updateKasaKur(); updateOrtakKur(); renderStats();
        document.getElementById('kurUpdateTime').textContent = 'Son güncelleme: ' + kurlar.updated;
        showToast('TCMB kurları güncellendi ✓');
        return;
      }
    }
  } catch(e) { console.warn('TCMB kaynak 2 başarısız:', e.message); }

  // ---- KAYNAK 3: Frankfurter (EUR baz, cross rate ile TRY hesapla) ----
  try {
    const res = await fetchWithTimeout('https://api.frankfurter.app/latest?to=TRY,USD,GBP');
    if (res.ok) {
      const data = await res.json();
      // data.base = EUR, data.rates = { TRY: X, USD: Y, GBP: Z }
      const eurTry = data.rates.TRY;
      if (eurTry > 1) {
        kurlar.EUR = eurTry;
        kurlar.USD = eurTry / data.rates.USD;
        kurlar.GBP = eurTry / data.rates.GBP;
        // RUB için ayrı istek
        try {
          const rubRes = await fetchWithTimeout('https://api.frankfurter.app/latest?from=EUR&to=RUB');
          if (rubRes.ok) {
            const rubData = await rubRes.json();
            kurlar.RUB = rubData.rates.RUB ? eurTry / rubData.rates.RUB : kurlar.RUB;
          }
        } catch(e2) {}
        kurlar.updated = new Date().toLocaleTimeString('tr-TR') + ' · Frankfurter';
        saveKurlar(); renderKurBar(); updateKasaKur(); updateOrtakKur(); renderStats();
        document.getElementById('kurUpdateTime').textContent = 'Son güncelleme: ' + kurlar.updated;
        showToast('Kurlar güncellendi ✓ (yedek kaynak)');
        return;
      }
    }
  } catch(e) { console.warn('Frankfurter başarısız:', e.message); }

  // ---- HİÇBİRİ ÇALIŞMADI ----
  if (kurlar.USD > 1) {
    // Eski kur var, sessizce kullan
    renderKurBar();
    document.getElementById('kurUpdateTime').textContent =
      '⚠ Güncel kur alınamadı · Son: ' + (kurlar.updated || 'bilinmiyor');
    showToast('Güncel kur alınamadı — son kayıtlı kur kullanılıyor', 'error');
  } else {
    // Hiç kur yok, manuel giriş iste
    document.getElementById('kurUpdateTime').textContent = '⚠ Kur bilgisi yok — manuel girin';
    renderKurBar();
    showToast('Kur bilgisi alınamadı — lütfen manuel girin', 'error');
    // Mevcut değerleri modal'a doldur
    document.getElementById('mKurUSD').value = '';
    document.getElementById('mKurEUR').value = '';
    document.getElementById('mKurGBP').value = '';
    document.getElementById('mKurRUB').value = '';
    openKurPanel();
  }
}

function renderKurBar() {
  const fmtK = v => v ? v.toFixed(v < 1 ? 4 : 2) + ' ₺' : '—';
  document.getElementById('kur-usd').textContent = fmtK(kurlar.USD);
  document.getElementById('kur-eur').textContent = fmtK(kurlar.EUR);
  document.getElementById('kur-gbp').textContent = fmtK(kurlar.GBP);
  document.getElementById('kur-rub').textContent = fmtK(kurlar.RUB);
  if (kurlar.updated) document.getElementById('kurUpdateTime').textContent = 'Son güncelleme: ' + kurlar.updated;
}

function updateKasaKur() {
  const para = document.getElementById('kasaPara').value;
  const group = document.getElementById('kasaKurGroup');
  const kurInput = document.getElementById('kasaKur');
  if (para === 'TL') { group.style.display = 'none'; }
  else {
    group.style.display = '';
    kurInput.value = (kurlar[para] || '').toFixed ? (kurlar[para] || 0).toFixed(2) : '';
  }
}

// ===== KASA =====
function kasaEkle() {
  const tur = document.getElementById('kasaTur').value;
  const para = document.getElementById('kasaPara').value;
  const tutar = parseFloat(document.getElementById('kasaTutar').value);
  const aciklama = document.getElementById('kasaAciklama').value.trim();
  const tarih = document.getElementById('kasaTarih').value;
  const kur = para === 'TL' ? 1 : parseFloat(document.getElementById('kasaKur').value) || 0;

  if (!tutar || tutar <= 0) { showToast('Geçerli tutar girin', 'error'); return; }
  if (!tarih) { showToast('Tarih seçin', 'error'); return; }
  if (para !== 'TL' && !kur) { showToast('Kur girin', 'error'); return; }

  state.kasa.push({
    id: Date.now(), tur, para, tutar, kur, aciklama, tarih,
    kullaniciAd: kasaCurrentUser ? kasaCurrentUser.ad : '—'
  });
  state.kasa.sort((a,b) => b.tarih.localeCompare(a.tarih));
  save();

  document.getElementById('kasaTutar').value = '';
  document.getElementById('kasaAciklama').value = '';

  renderKasa(); renderStats(); renderOzet();
  showToast('Kasa hareketi eklendi ✓');
}

function kasaSil(id) {
  if (!confirm('Bu hareketi silmek istiyor musunuz?')) return;
  state.kasa = state.kasa.filter(k => k.id !== id);
  save(); renderKasa(); renderStats(); renderOzet();
  showToast('Silindi');
}

function renderKasa() {
  const filter = document.getElementById('kasaFilterTarih').value;
  let rows = filter ? state.kasa.filter(k => k.tarih === filter) : state.kasa;
  const tbody = document.getElementById('kasaTable');
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><div class="icon">💰</div><p>Henüz kasa hareketi yok</p></div></td></tr>`; return; }
  tbody.innerHTML = rows.map(k => {
    const tlKarsiligi = k.tutar * k.kur;
    return `<tr>
      <td>${formatDate(k.tarih)}</td>
      <td><span class="badge ${k.tur==='giris'?'badge-green':'badge-red'}">${k.tur==='giris'?'📈 Giriş':'📉 Çıkış'}</span></td>
      <td class="${k.tur==='giris'?'amount-pos':'amount-neg'}">${k.tur==='giris'?'+':'−'}${fmt(k.tutar)}</td>
      <td><span class="badge badge-blue">${k.para}</span></td>
      <td class="amount">${k.para==='TL'?'—':fmt(k.kur)+' ₺'}</td>
      <td class="amount">${fmt(tlKarsiligi)} ₺</td>
      <td style="color:var(--text2)">${k.aciklama||'—'}</td>
      <td style="color:var(--accent);font-size:11px;font-weight:700">${k.kullaniciAd ? '👤 ' + k.kullaniciAd : '—'}</td>
      <td><button class="btn btn-danger btn-icon btn-sm" onclick="kasaSil(${k.id})">🗑</button></td>
    </tr>`;
  }).join('');
}

function renderStats() {
  const bakiye = { TL: 0, EUR: 0, USD: 0, GBP: 0, RUB: 0 };

  // Manuel kasa hareketleri
  state.kasa.forEach(k => {
    const para = k.para || 'TL';
    if (bakiye[para] === undefined) bakiye[para] = 0;
    bakiye[para] += (k.tur === 'giris' ? k.tutar : -k.tutar);
  });

  // Satışlar — EUR olarak ekle
  satislarCache.forEach(s => {
    bakiye['EUR'] += (s.total || 0);
  });

  // Ortak hareketleri
  state.ortakIslemler.forEach(i => {
    const etki = ORTAK_KASA_ETKI[i.tur];
    const para = i.para || 'TL';
    if (bakiye[para] === undefined) bakiye[para] = 0;
    bakiye[para] += (etki === 'giris' ? i.tutar : -i.tutar);
  });

  // Giderler TL'den düş
  const topGider = state.giderler.reduce((s,g) => s + g.tutar, 0);
  bakiye['TL'] -= topGider;

  document.getElementById('stat-tl').textContent = fmt(bakiye.TL || 0) + ' ₺';
  document.getElementById('stat-eur').textContent = fmt(bakiye.EUR || 0) + ' €';
  document.getElementById('stat-usd').textContent = fmt(bakiye.USD || 0) + ' $';
  document.getElementById('stat-gbp').textContent = fmt(bakiye.GBP || 0) + ' £';

  ['eur','usd','gbp'].forEach(c => {
    const el = document.getElementById('stat-' + c);
    const val = bakiye[c.toUpperCase()] || 0;
    el.className = 'stat-value ' + (val >= 0 ? 'green' : 'red');
  });
}

let satislarCache = [];

function renderKasaSatislar() {
  const el = document.getElementById('kasaSatislarListesi');
  if (!el) return;
  if (!satislarCache.length) {
    el.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="icon">🧾</div><p>Henüz satış yok</p></div></td></tr>`;
    return;
  }
  el.innerHTML = satislarCache.map(s => {
    const d = new Date(s.tarih);
    const tarihStr = d.toLocaleDateString('tr-TR', {day:'2-digit', month:'short'}) + ' ' + d.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
    return `<tr>
      <td>${tarihStr}</td>
      <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.items.map(i=>i.emoji+' '+i.name+(i.qty>1?' ×'+i.qty:'')).join(', ')}</td>
      <td class="amount-pos" style="font-weight:800">€${fmt(s.total)}</td>
      <td style="color:var(--accent);font-size:11px;font-weight:700">${s.kullaniciAd||'—'}</td>
      <td><button class="btn btn-danger btn-icon btn-sm" onclick="satisSil('${s.id}')">🗑</button></td>
    </tr>`;
  }).join('');
}

async function satisSil(id) {
  if (!confirm('Bu satışı silmek istiyor musunuz?')) return;
  const db = getDB();
  if (!db) { showToast('Bağlantı yok', 'error'); return; }
  const { doc, deleteDoc, collection } = window._fb;
  try {
    await deleteDoc(doc(collection(db, 'satislar'), String(id)));
    showToast('Satış silindi');
  } catch(e) {
    console.error(e);
    showToast('Silinemedi: ' + e.message, 'error');
  }
}
// ===== GEÇMİŞ BORÇ =====
function gbEkle() {
  const aciklama = document.getElementById('gbAciklama').value.trim();
  const para = document.getElementById('gbPara').value;
  const tutar = parseFloat(document.getElementById('gbTutar').value);
  const tarih = document.getElementById('gbTarih').value;

  if (!aciklama) { showToast('Açıklama girin', 'error'); return; }
  if (!tutar || tutar <= 0) { showToast('Geçerli tutar girin', 'error'); return; }
  if (!tarih) { showToast('Tarih seçin', 'error'); return; }

  if (!state.gecmisBorc) state.gecmisBorc = [];
  state.gecmisBorc.push({ id: Date.now(), aciklama, para, tutar, tarih, odendi: false });
  state.gecmisBorc.sort((a,b) => b.tarih.localeCompare(a.tarih));
  save();

  document.getElementById('gbAciklama').value = '';
  document.getElementById('gbTutar').value = '';
  renderGecmisBorc();
  showToast('Borç kalemi eklendi ✓');
}

function gbOdendi(id) {
  const item = state.gecmisBorc.find(x => x.id === id);
  if (!item) return;
  item.odendi = !item.odendi;
  save();
  renderGecmisBorc();
}

function gbSil(id) {
  if (!confirm('Bu borç kalemini silmek istiyor musunuz?')) return;
  state.gecmisBorc = state.gecmisBorc.filter(x => x.id !== id);
  save();
  renderGecmisBorc();
  showToast('Silindi');
}

function renderGecmisBorc() {
  if (!state.gecmisBorc) state.gecmisBorc = [];
  const filter = document.getElementById('gbFilterPara')?.value || '';
  const rows = filter ? state.gecmisBorc.filter(x => x.para === filter) : state.gecmisBorc;

  const sym = {EUR:'€', TL:'₺', USD:'$', GBP:'£'};

  // Ödenmemiş toplamlar para birimlerine göre
  const toplamlar = {};
  state.gecmisBorc.filter(x => !x.odendi).forEach(x => {
    toplamlar[x.para] = (toplamlar[x.para] || 0) + x.tutar;
  });
  // Toptancı eski borçlarını da ekle
  (state.toptanciEskiBorc||[]).forEach(b => {
    const p = b.para||'TL';
    toplamlar[p] = (toplamlar[p]||0) + b.tutar;
  });
  const toplamStr = Object.entries(toplamlar).map(([p,t]) => `${sym[p]||''}${fmt(t)} ${p}`).join(' + ') || '—';
  document.getElementById('gecmisBorcToplam').textContent = toplamStr;
  document.getElementById('gecmisBorcParaBirimi').textContent = 'Ödenmemiş + Toptancı eski borç toplamı';

  const tbody = document.getElementById('gecmisBorcTable');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="icon">🕰</div><p>Geçmiş borç kaydı yok</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(x => `<tr style="${x.odendi ? 'opacity:.45;' : ''}">
    <td>${formatDate(x.tarih)}</td>
    <td style="color:var(--text2)">${x.aciklama}</td>
    <td class="${x.odendi ? '' : 'amount-neg'}" style="font-weight:800">${sym[x.para]||''}${fmt(x.tutar)}</td>
    <td><span class="badge badge-blue">${x.para}</span></td>
    <td>
      <button onclick="gbOdendi(${x.id})" style="background:${x.odendi ? 'rgba(16,185,129,.15)' : 'rgba(245,158,11,.12)'};border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:700;color:${x.odendi ? 'var(--green)' : 'var(--accent)'}">
        ${x.odendi ? '✅ Ödendi' : '⏳ Bekliyor'}
      </button>
    </td>
    <td><button class="btn btn-danger btn-icon btn-sm" onclick="gbSil(${x.id})">🗑</button></td>
  </tr>`).join('');
}

function openToptanciModal() {
  ['toptanciAdi','toptanciTel','toptanciNot'].forEach(id => document.getElementById(id).value = '');
  openModal('toptanciModal');
}

function toptanciEkle() {
  const adi = document.getElementById('toptanciAdi').value.trim();
  if (!adi) { showToast('Toptancı adı girin', 'error'); return; }
  state.toptancilar.push({ id: Date.now(), adi, tel: document.getElementById('toptanciTel').value.trim(), not: document.getElementById('toptanciNot').value.trim() });
  save(); closeModal('toptanciModal');
  renderToptanciKartlar(); renderToptanciIslemler(); renderToptanciFilter();
  showToast('Toptancı eklendi ✓');
}

function toptanciSil(id) {
  if (!confirm('Bu toptancıyı ve tüm hareketlerini silmek istiyor musunuz?')) return;
  state.toptancilar = state.toptancilar.filter(t => t.id !== id);
  state.toptanciIslemler = state.toptanciIslemler.filter(i => i.toptanciId !== id);
  save(); renderToptanciKartlar(); renderToptanciIslemler(); renderToptanciFilter(); renderOzet();
  showToast('Toptancı silindi');
}

const SYM = {EUR:'€',TL:'₺',USD:'$',GBP:'£'};

function getToptanciBakiyeByPara(tid) {
  // {EUR: x, TL: y, ...} — eski borç + normal işlemler
  const bakiye = {};
  // Eski borçlar
  (state.toptanciEskiBorc||[]).filter(b => b.toptanciId === tid).forEach(b => {
    const p = b.para||'TL';
    bakiye[p] = (bakiye[p]||0) + b.tutar;
  });
  // Normal işlemler
  state.toptanciIslemler.filter(i => i.toptanciId === tid).forEach(i => {
    const p = i.para||'TL';
    if (i.tur === 'alis') bakiye[p] = (bakiye[p]||0) + i.tutar;
    else bakiye[p] = (bakiye[p]||0) - i.tutar; // odeme veya iade
  });
  return bakiye;
}

function getToptanciBakiye(tid) {
  // geriye uyumluluk — TL toplamı döndür
  const bk = getToptanciBakiyeByPara(tid);
  return bk['TL'] || 0;
}

function islemTurDegisti() {
  const tur = document.getElementById('islemTur').value;
  const senetAlani = document.getElementById('islemSenetAlani');
  const odemeYontemiAlani = document.getElementById('islemOdemeYontemiAlani');
  if (senetAlani) senetAlani.style.display = tur === 'alis' ? '' : 'none';
  if (odemeYontemiAlani) odemeYontemiAlani.style.display = (tur === 'odeme' || tur === 'iade') ? '' : 'none';
  // reset seçim
  const nakit = document.querySelector('input[name="odemeYontemi"][value="nakit"]');
  if (nakit) { nakit.checked = true; odemeYontemiDegisti(); }
}

function odemeYontemiDegisti() {
  const secili = document.querySelector('input[name="odemeYontemi"]:checked')?.value;
  const vadeAlani = document.getElementById('islemOdemeVadeAlani');
  if (vadeAlani) vadeAlani.style.display = (secili === 'kredi' || secili === 'senet') ? 'flex' : 'none';
}

// Radio butonlarına event ekle (sayfa yüklenince)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="odemeYontemi"]').forEach(r =>
    r.addEventListener('change', odemeYontemiDegisti)
  );
});

function renderToptanciKartlar() {
  const el = document.getElementById('toptanciKartlar');
  if (!state.toptancilar.length) {
    el.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="empty"><div class="icon">🏭</div><p>Henüz toptancı eklenmedi</p></div></div>`;
    renderEskiBorcOzet();
    return;
  }
  el.innerHTML = state.toptancilar.map(t => {
    const bakiyeByPara = getToptanciBakiyeByPara(t.id);
    const islemSayisi = state.toptanciIslemler.filter(i => i.toptanciId === t.id).length;
    const eskiBorcSayisi = (state.toptanciEskiBorc||[]).filter(b => b.toptanciId === t.id).length;
    const borcStr = Object.entries(bakiyeByPara)
      .filter(([,v]) => Math.abs(v) > 0.001)
      .map(([p,v]) => `<span class="${v>0?'amount-neg':'amount-pos'}" style="font-size:15px;font-weight:800">${SYM[p]||''}${fmt(Math.abs(v))} ${p} ${v>0?'📛':'✅'}</span>`)
      .join('<br>') || '<span class="amount-pos">Borç Yok ✅</span>';
    return `<div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div class="borc-avatar">${t.adi[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:800">${t.adi}</div>
          <div style="font-size:11px;color:var(--text2)">${t.tel||'Telefon yok'} · ${islemSayisi} işlem${eskiBorcSayisi?' · '+eskiBorcSayisi+' eski borç':''}</div>
        </div>
        <button class="btn btn-danger btn-icon btn-sm" onclick="toptanciSil(${t.id})">🗑</button>
      </div>
      <div class="ozet-row" style="border-top:2px solid var(--border);padding-top:12px">
        <span style="font-weight:700">Açık Borç</span>
        <div style="text-align:right">${borcStr}</div>
      </div>
      ${t.not?`<div style="margin-top:10px;font-size:11px;color:var(--text2);background:var(--bg);border-radius:7px;padding:8px">${t.not}</div>`:''}
    </div>`;
  }).join('');
  renderEskiBorcOzet();
}

function openIslemModal() {
  if (!state.toptancilar.length) { showToast('Önce toptancı ekleyin', 'error'); return; }
  const sel = document.getElementById('islemToptanci');
  sel.innerHTML = state.toptancilar.map(t => `<option value="${t.id}">${t.adi}</option>`).join('');
  document.getElementById('islemTutar').value = '';
  document.getElementById('islemAciklama').value = '';
  document.getElementById('islemTarih').value = todayStr();
  document.getElementById('islemVade').value = '';
  document.getElementById('islemSenetNo').value = '';
  document.getElementById('islemOdemeVade').value = '';
  document.getElementById('islemOdemeBelgeNo').value = '';
  document.getElementById('islemTur').value = 'alis';
  islemTurDegisti();
  openModal('islemModal');
}

function islemEkle() {
  const toptanciId = parseInt(document.getElementById('islemToptanci').value);
  const tur = document.getElementById('islemTur').value;
  const para = document.getElementById('islemPara').value || 'TL';
  const tutar = parseFloat(document.getElementById('islemTutar').value);
  const tarih = document.getElementById('islemTarih').value;
  const aciklama = document.getElementById('islemAciklama').value.trim();
  const vade = document.getElementById('islemVade').value || null;
  const senetNo = document.getElementById('islemSenetNo').value.trim() || null;
  // Ödeme alanları
  const odemeYontemi = (tur === 'odeme' || tur === 'iade')
    ? (document.querySelector('input[name="odemeYontemi"]:checked')?.value || 'nakit') : null;
  const odemeVade = (odemeYontemi === 'kredi' || odemeYontemi === 'senet')
    ? (document.getElementById('islemOdemeVade').value || null) : null;
  const odemeBelgeNo = (odemeYontemi === 'kredi' || odemeYontemi === 'senet')
    ? (document.getElementById('islemOdemeBelgeNo').value.trim() || null) : null;

  if (!tutar || tutar <= 0) { showToast('Geçerli tutar girin', 'error'); return; }
  if (!tarih) { showToast('Tarih seçin', 'error'); return; }
  state.toptanciIslemler.push({ id: Date.now(), toptanciId, tur, para, tutar, tarih, aciklama, vade, senetNo, odemeYontemi, odemeVade, odemeBelgeNo });
  state.toptanciIslemler.sort((a,b) => b.tarih.localeCompare(a.tarih));
  save(); closeModal('islemModal');
  renderToptanciKartlar(); renderToptanciIslemler(); renderOzet();
  renderVadeHatirlatici();
  showToast('İşlem eklendi ✓');
}

function islemSil(id) {
  if (!confirm('Bu işlemi silmek istiyor musunuz?')) return;
  state.toptanciIslemler = state.toptanciIslemler.filter(i => i.id !== id);
  save(); renderToptanciKartlar(); renderToptanciIslemler(); renderOzet();
  renderVadeHatirlatici();
  showToast('Silindi');
}

function renderToptanciFilter() {
  const sel = document.getElementById('toptanciFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tüm Toptancılar</option>' +
    state.toptancilar.map(t => `<option value="${t.id}" ${t.id==cur?'selected':''}>${t.adi}</option>`).join('');
}

function renderToptanciIslemler() {
  const filter = document.getElementById('toptanciFilter').value;
  let rows = filter ? state.toptanciIslemler.filter(i => i.toptanciId == filter) : state.toptanciIslemler;
  const tbody = document.getElementById('toptanciIslemTable');
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="icon">🏭</div><p>Henüz hareket yok</p></div></td></tr>`; return; }
  const turLabel = { alis:'🛒 Alış', odeme:'💳 Ödeme', iade:'↩️ İade' };
  const turClass = { alis:'badge-red', odeme:'badge-green', iade:'badge-blue' };
  const yontemLabel = { nakit:'💵 Nakit', kredi:'💳 Kredi', senet:'📄 Senet', havale:'🏦 Havale' };
  tbody.innerHTML = rows.map(i => {
    const t = state.toptancilar.find(t => t.id === i.toptanciId);
    const p = i.para || 'TL';
    const bakiyeByPara = getToptanciBakiyeByPara(i.toptanciId);
    const bakiyeStr = Object.entries(bakiyeByPara)
      .filter(([,v]) => Math.abs(v) > 0.001)
      .map(([pp,v]) => `${SYM[pp]||''}${fmt(Math.abs(v))} ${pp}`)
      .join(' / ') || '0';
    const vadeBadge = i.vade ? `<br><span style="font-size:10px;color:${isVadeGecti(i.vade)?'var(--red)':'var(--accent)'}">📄 Alış vadesi: ${formatDate(i.vade)}${i.senetNo?' #'+i.senetNo:''}</span>` : '';
    let odemeBadge = '';
    if (i.odemeYontemi && i.odemeYontemi !== 'nakit') {
      odemeBadge = `<br><span style="font-size:10px;font-weight:700;color:var(--green)">${yontemLabel[i.odemeYontemi]||i.odemeYontemi}</span>`;
      if (i.odemeVade) {
        const gecti = i.odemeVade < todayStr();
        odemeBadge += `<span style="font-size:10px;color:${gecti?'var(--red)':'var(--text3)'};margin-left:4px">Vade: ${formatDate(i.odemeVade)}${i.odemeBelgeNo?' #'+i.odemeBelgeNo:''} ${gecti?'⚠️':''}</span>`;
      }
    } else if (i.odemeYontemi === 'nakit') {
      odemeBadge = `<br><span style="font-size:10px;color:var(--text3)">💵 Nakit</span>`;
    }
    return `<tr>
      <td>${formatDate(i.tarih)}${vadeBadge}</td>
      <td style="font-weight:600">${t ? t.adi : '?'}</td>
      <td><span class="badge ${turClass[i.tur]||'badge-blue'}">${turLabel[i.tur]||i.tur}</span>${odemeBadge}</td>
      <td class="${i.tur==='alis'?'amount-neg':'amount-pos'}">${i.tur==='alis'?'+':'−'}${fmt(i.tutar)}</td>
      <td><span class="badge badge-blue">${p}</span></td>
      <td style="color:var(--text2)">${i.aciklama||'—'}</td>
      <td style="font-size:11px">${bakiyeStr}</td>
      <td><button class="btn btn-danger btn-icon btn-sm" onclick="islemSil(${i.id})">🗑</button></td>
    </tr>`;
  }).join('');
}

// Eski borç (toptancı) fonksiyonları
function openEskiBorcModal() {
  if (!state.toptancilar.length) { showToast('Önce toptancı ekleyin', 'error'); return; }
  const sel = document.getElementById('eskiBorcToptanci');
  sel.innerHTML = state.toptancilar.map(t => `<option value="${t.id}">${t.adi}</option>`).join('');
  document.getElementById('eskiBorcTutar').value = '';
  document.getElementById('eskiBorcAciklama').value = '';
  document.getElementById('eskiBorcTarih').value = todayStr();
  openModal('eskiBorcModal');
}

function eskiBorcEkle() {
  const toptanciId = parseInt(document.getElementById('eskiBorcToptanci').value);
  const para = document.getElementById('eskiBorcPara').value || 'TL';
  const tutar = parseFloat(document.getElementById('eskiBorcTutar').value);
  const tarih = document.getElementById('eskiBorcTarih').value;
  const aciklama = document.getElementById('eskiBorcAciklama').value.trim();
  if (!tutar || tutar <= 0) { showToast('Geçerli tutar girin', 'error'); return; }
  if (!tarih) { showToast('Tarih seçin', 'error'); return; }
  if (!state.toptanciEskiBorc) state.toptanciEskiBorc = [];
  state.toptanciEskiBorc.push({ id: Date.now(), toptanciId, para, tutar, tarih, aciklama });
  save(); closeModal('eskiBorcModal');
  renderToptanciKartlar(); renderToptanciIslemler(); renderOzet();
  showToast('Eski borç eklendi ✓');
}

function eskiBorcSil(id) {
  if (!confirm('Bu eski borç kaydını silmek istiyor musunuz?')) return;
  state.toptanciEskiBorc = (state.toptanciEskiBorc||[]).filter(b => b.id !== id);
  save(); renderToptanciKartlar(); renderOzet();
  showToast('Silindi');
}

let eskiBorcDetayAcik = false;
function toggleEskiBorcDetay() {
  eskiBorcDetayAcik = !eskiBorcDetayAcik;
  renderEskiBorcOzet();
}

function renderEskiBorcOzet() {
  const eb = state.toptanciEskiBorc || [];
  const kart = document.getElementById('eskiBorcOzetKart');
  if (!eb.length) { if(kart) kart.style.display='none'; return; }
  if(kart) kart.style.display='';

  // Özet: toptancı başına eski borç toplamı para bazında
  const ozetEl = document.getElementById('eskiBorcOzet');
  const detayEl = document.getElementById('eskiBorcDetay');
  const btn = document.getElementById('eskiBorcToggleBtn');

  const gruplar = {};
  eb.forEach(b => {
    if (!gruplar[b.toptanciId]) gruplar[b.toptanciId] = {};
    const p = b.para||'TL';
    gruplar[b.toptanciId][p] = (gruplar[b.toptanciId][p]||0) + b.tutar;
  });

  ozetEl.innerHTML = Object.entries(gruplar).map(([tid, paralar]) => {
    const t = state.toptancilar.find(t => t.id == tid);
    const borcStr = Object.entries(paralar).map(([p,v]) => `${SYM[p]||''}${fmt(v)} ${p}`).join(' + ');
    return `<div class="ozet-row"><span style="font-weight:600">${t?t.adi:'?'}</span><span class="amount-neg">${borcStr}</span></div>`;
  }).join('');

  if (btn) btn.textContent = eskiBorcDetayAcik ? '▲ Gizle' : '▼ Detay';
  if (detayEl) {
    detayEl.style.display = eskiBorcDetayAcik ? '' : 'none';
    if (eskiBorcDetayAcik) {
      detayEl.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Toptancı</th><th>Tutar</th><th>Para</th><th>Açıklama</th><th></th></tr></thead>
        <tbody>${eb.map(b => {
          const t = state.toptancilar.find(t => t.id==b.toptanciId);
          return `<tr>
            <td>${formatDate(b.tarih)}</td>
            <td>${t?t.adi:'?'}</td>
            <td class="amount-neg">${SYM[b.para]||''}${fmt(b.tutar)}</td>
            <td><span class="badge badge-blue">${b.para||'TL'}</span></td>
            <td>${b.aciklama||'—'}</td>
            <td><button class="btn btn-danger btn-icon btn-sm" onclick="eskiBorcSil(${b.id})">🗑</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }
  }
}

// Vade hatırlatıcısı
function isVadeGecti(vade) {
  return vade && vade < todayStr();
}

function renderVadeHatirlatici() {
  const el = document.getElementById('vadeHatirlatici');
  if (!el) return;
  const today = todayStr();

  // Alış vadeleri
  const alisVadeler = state.toptanciIslemler.filter(i => i.vade && i.tur === 'alis');
  // Ödeme vadeleri (senet / kredi)
  const odemeVadeler = state.toptanciIslemler.filter(i => i.odemeVade && (i.tur === 'odeme' || i.tur === 'iade'));

  const tumVadeler = [
    ...alisVadeler.map(i => ({ ...i, _vadeKey: i.vade, _tip: 'alis' })),
    ...odemeVadeler.map(i => ({ ...i, _vadeKey: i.odemeVade, _tip: 'odeme' }))
  ].filter(i => {
    const v = i._vadeKey;
    return v < today || v === today || v <= addDays(today, 7);
  }).sort((a,b) => a._vadeKey.localeCompare(b._vadeKey));

  if (!tumVadeler.length) { el.style.display='none'; return; }
  el.style.display='';

  const yontemLabel = { nakit:'💵 Nakit', kredi:'💳 Kredi', senet:'📄 Senet', havale:'🏦 Havale' };

  const rows = tumVadeler.map(i => {
    const t = state.toptancilar.find(t => t.id === i.toptanciId);
    const vade = i._vadeKey;
    const gunFark = dayDiff(today, vade);
    let durum, renk;
    if (vade < today) { durum = `${Math.abs(gunFark)} gün GECİKTİ`; renk = 'var(--red)'; }
    else if (vade === today) { durum = 'BUGÜN'; renk = 'var(--red)'; }
    else { durum = `${gunFark} gün kaldı`; renk = 'var(--accent)'; }

    const tipLabel = i._tip === 'alis'
      ? `📄 Alış vadesi${i.senetNo?' #'+i.senetNo:''}`
      : `${yontemLabel[i.odemeYontemi]||'Ödeme'} vadesi${i.odemeBelgeNo?' #'+i.odemeBelgeNo:''}`;

    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:12px;font-weight:700">${t?t.adi:'?'} — ${SYM[i.para]||''}${fmt(i.tutar)} ${i.para||'TL'}</div>
        <div style="font-size:10px;color:var(--text3)">${tipLabel} · ${i.aciklama||'—'}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;font-weight:800;color:${renk}">${durum}</div>
        <div style="font-size:10px;color:var(--text3)">${formatDate(vade)}</div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="card" style="border:1.5px solid rgba(244,63,94,.3)">
    <div class="card-title" style="color:var(--red)">📄 Vadeli Borç / Senet / Ödeme Hatırlatıcısı</div>
    ${rows}
  </div>`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr); d.setDate(d.getDate()+days);
  return d.toISOString().split('T')[0];
}

function dayDiff(from, to) {
  return Math.round((new Date(to)-new Date(from))/(1000*60*60*24));
}

// ===== GİDER =====
function giderOrtakDropdownDoldur() {
  const sel = document.getElementById('giderOrtak');
  if (!sel) return;
  const mevcut = sel.value;
  sel.innerHTML = '<option value="">— İşletme Gideri —</option>' +
    state.ortaklar.map(o => `<option value="${o.id}">${o.ad}</option>`).join('');
  sel.value = mevcut;
}

function giderEkle() {
  const tur = document.getElementById('giderTur').value;
  const para = document.getElementById('giderPara').value;
  const tutar = parseFloat(document.getElementById('giderTutar').value);
  const aciklama = document.getElementById('giderAciklama').value.trim();
  const tarih = document.getElementById('giderTarih').value;
  const ortakId = document.getElementById('giderOrtak')?.value || '';
  if (!tutar || tutar <= 0) { showToast('Geçerli tutar girin', 'error'); return; }
  if (!tarih) { showToast('Tarih seçin', 'error'); return; }

  const giderId = Date.now();
  state.giderler.push({ id: giderId, tur, para: para||'TL', tutar, aciklama, tarih, ortakId: ortakId||null });
  state.giderler.sort((a,b) => b.tarih.localeCompare(a.tarih));

  // Ortak seçildiyse ortakIslemler'e kisisel_borc olarak da ekle
  if (ortakId) {
    const kur = para === 'TL' ? 1 : (kurlar[para] || 1);
    state.ortakIslemler.push({
      id: giderId + 1,
      ortakId,
      tur: 'kisisel_borc',
      para: para || 'TL',
      tutar,
      kur,
      aciklama: `[Gider] ${tur}${aciklama ? ' — ' + aciklama : ''}`,
      tarih,
      giderRef: giderId  // giderle bağlantı
    });
    state.ortakIslemler.sort((a,b) => b.tarih.localeCompare(a.tarih));
  }

  save();
  document.getElementById('giderTutar').value = '';
  document.getElementById('giderAciklama').value = '';
  renderGider(); renderGiderStats(); renderOzet();
  renderOrtakBakiyeKartlar(); renderOrtakIslemler();
  showToast(ortakId ? `Gider eklendi — ${state.ortaklar.find(o=>o.id===ortakId)?.ad} adına borç kaydedildi ✓` : 'Gider eklendi ✓');
}

function giderSil(id) {
  if (!confirm('Bu gideri silmek istiyor musunuz?')) return;
  state.giderler = state.giderler.filter(g => g.id !== id);
  // Bağlı ortakIslem varsa onu da sil
  state.ortakIslemler = state.ortakIslemler.filter(i => i.giderRef !== id);
  save(); renderGider(); renderGiderStats(); renderOzet();
  renderOrtakBakiyeKartlar(); renderOrtakIslemler();
  showToast('Silindi');
}

function renderGider() {
  const tbody = document.getElementById('giderTable');
  if (!state.giderler.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="icon">📋</div><p>Henüz gider kaydı yok</p></div></td></tr>`; return; }
  const turEmoji = { Muhasebe:'📑',Gün:'📅',Market:'🛒',Kira:'🏠',Elektrik:'💡',Su:'💧','Doğalgaz':'🔥','İnternet':'📶',Personel:'👥',Vergi:'🧾',Nakliye:'🚚','Diğer':'📌' };
  const sym = {EUR:'€',TL:'₺',USD:'$',GBP:'£'};
  tbody.innerHTML = state.giderler.map(g => {
    const ortak = g.ortakId ? state.ortaklar.find(o => o.id === g.ortakId) : null;
    return `<tr>
    <td>${formatDate(g.tarih)}</td>
    <td><span class="badge badge-yellow">${turEmoji[g.tur]||'📌'} ${g.tur}</span></td>
    <td class="amount-neg">−${fmt(g.tutar)}</td>
    <td><span class="badge badge-blue">${g.para||'TL'}</span></td>
    <td style="color:var(--text2)">${g.aciklama||'—'}</td>
    <td>${ortak ? `<span class="badge badge-purple" style="background:rgba(139,92,246,.15);color:#8b5cf6">👤 ${ortak.ad}</span>` : '<span style="color:var(--text3);font-size:11px">İşletme</span>'}</td>
    <td><button class="btn btn-danger btn-icon btn-sm" onclick="giderSil(${g.id})">🗑</button></td>
  </tr>`;
  }).join('');
}

function renderGiderStats() {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const thisYear = `${now.getFullYear()}`;
  const sym = {EUR:'€',TL:'₺',USD:'$',GBP:'£'};
  // Ay giderleri para birimi bazında
  const ayGider = {}; const yilGider = {};
  state.giderler.forEach(g => {
    const p = g.para||'TL';
    if (g.tarih.startsWith(thisMonth)) ayGider[p] = (ayGider[p]||0) + g.tutar;
    if (g.tarih.startsWith(thisYear)) yilGider[p] = (yilGider[p]||0) + g.tutar;
  });
  const fmtMulti = obj => Object.entries(obj).map(([p,t]) => `${sym[p]||''}${fmt(t)}`).join(' + ') || '0';
  document.getElementById('stat-ay-gider').textContent = fmtMulti(ayGider);
  document.getElementById('stat-yil-gider').textContent = fmtMulti(yilGider);
}

// ===== ÖZET =====
function renderOzet() {
  const sym = {EUR:'€',TL:'₺',USD:'$',GBP:'£',RUB:'₽'};
  const eurKur = kurlar.EUR || 1;
  const toEUR = (tutar, para) => {
    if (para==='EUR') return tutar;
    if (para==='TL')  return tutar / eurKur;
    if (para==='USD') return tutar * (kurlar.USD||1) / eurKur;
    if (para==='GBP') return tutar * (kurlar.GBP||1) / eurKur;
    return tutar / eurKur;
  };

  // ── NET BİLANÇO (tüm zamanlar) ──
  const nbGelir = {}, nbGider = {}, nbToptanciOdeme = {};

  // Satış geliri
  nbGelir['EUR'] = satislarCache.reduce((s,x)=>s+(x.total||0),0);

  // Kasa hareketleri
  state.kasa.forEach(k => {
    const p = k.para||'TL';
    if (k.tur==='giris') nbGelir[p] = (nbGelir[p]||0) + k.tutar;
    else nbGider[p] = (nbGider[p]||0) + k.tutar;
  });

  // Giderler
  state.giderler.forEach(g => {
    const p = g.para||'TL';
    nbGider[p] = (nbGider[p]||0) + g.tutar;
  });

  // Toptancı ödemeleri
  state.toptanciIslemler.filter(i=>i.tur!=='alis').forEach(i => {
    const p = i.para||'TL';
    nbToptanciOdeme[p] = (nbToptanciOdeme[p]||0) + i.tutar;
  });

  const totalGelirEUR = Object.entries(nbGelir).reduce((s,[p,v])=>s+toEUR(v,p),0);
  const totalGiderEUR = Object.entries(nbGider).reduce((s,[p,v])=>s+toEUR(v,p),0);
  const totalTopOdemeEUR = Object.entries(nbToptanciOdeme).reduce((s,[p,v])=>s+toEUR(v,p),0);
  const netEUR = totalGelirEUR - totalGiderEUR - totalTopOdemeEUR;

  const mkRow = (label, byPara, sign) =>
    Object.entries(byPara).filter(([,v])=>v>0.001).map(([p,v]) =>
      `<div class="ozet-row">
        <span class="ozet-label" style="padding-left:10px;font-size:12px">↳ ${label} ${p}</span>
        <span class="${sign>0?'amount-pos':'amount-neg'} ozet-val">${sign>0?'+':'−'}${sym[p]||''}${fmt(v)}</span>
      </div>`).join('');

  const netEl = document.getElementById('ozetNetBilanco');
  if (netEl) netEl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
      <div style="text-align:center;padding:12px;background:rgba(16,185,129,.08);border-radius:10px">
        <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Toplam Gelir</div>
        <div style="font-size:18px;font-weight:800;color:var(--green)">€${fmt(totalGelirEUR)}</div>
      </div>
      <div style="text-align:center;padding:12px;background:rgba(244,63,94,.08);border-radius:10px">
        <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Toplam Çıkış</div>
        <div style="font-size:18px;font-weight:800;color:var(--red)">€${fmt(totalGiderEUR+totalTopOdemeEUR)}</div>
      </div>
      <div style="text-align:center;padding:12px;background:${netEUR>=0?'rgba(16,185,129,.12)':'rgba(244,63,94,.12)'};border-radius:10px;border:2px solid ${netEUR>=0?'rgba(16,185,129,.4)':'rgba(244,63,94,.4)'}">
        <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Net</div>
        <div style="font-size:22px;font-weight:800;color:${netEUR>=0?'var(--green)':'var(--red)'}">${netEUR>=0?'+':''}€${fmt(netEUR)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="font-size:10px;font-weight:800;color:var(--green);text-transform:uppercase;margin-bottom:4px">📈 Gelir Detayı</div>
        ${mkRow('Satış', {EUR: nbGelir['EUR']||0}, 1)}
        ${mkRow('Kasa Giriş', Object.fromEntries(Object.entries(nbGelir).filter(([p,v])=>p!=='EUR'&&v>0.001)), 1)}
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;color:var(--red);text-transform:uppercase;margin-bottom:4px">📉 Çıkış Detayı</div>
        ${mkRow('Gider', nbGider, -1)}
        ${mkRow('Toptancı', nbToptanciOdeme, -1)}
      </div>
    </div>
    ${eurKur>1?`<div style="font-size:10px;color:var(--text3);margin-top:8px;text-align:right">* EUR eşdeğeri — 1 EUR = ${fmt(eurKur)} ₺ kuru ile hesaplandı</div>`:''}
  `;

  // Döviz bazlı bakiye hesapla
  const bakiye = { TL: 0, EUR: 0, USD: 0, GBP: 0, RUB: 0 };
  const giris = { TL: 0, EUR: 0, USD: 0, GBP: 0, RUB: 0 };
  const cikis = { TL: 0, EUR: 0, USD: 0, GBP: 0, RUB: 0 };

  state.kasa.forEach(k => {
    const p = k.para || 'TL';
    if (k.tur === 'giris') giris[p] = (giris[p]||0) + k.tutar;
    else cikis[p] = (cikis[p]||0) + k.tutar;
    bakiye[p] = (giris[p]||0) - (cikis[p]||0);
  });

  // Satışlar EUR olarak ekle
  satislarCache.forEach(s => {
    giris['EUR'] = (giris['EUR']||0) + (s.total||0);
    bakiye['EUR'] = (giris['EUR']||0) - (cikis['EUR']||0);
  });

  state.ortakIslemler.forEach(i => {
    const etki = ORTAK_KASA_ETKI[i.tur];
    const p = i.para || 'TL';
    if (etki === 'giris') giris[p] = (giris[p]||0) + i.tutar;
    else cikis[p] = (cikis[p]||0) + i.tutar;
    bakiye[p] = (giris[p]||0) - (cikis[p]||0);
  });

  const topGider = state.giderler.reduce((s,g)=>s+g.tutar,0);
  bakiye['TL'] = (bakiye['TL']||0) - topGider;

  const symMap = {EUR:'€',USD:'$',GBP:'£',RUB:'₽',TL:'₺'};
  const flag = {EUR:'🇪🇺',USD:'🇺🇸',GBP:'🇬🇧',RUB:'🇷🇺',TL:'🇹🇷'};

  // Kasa özeti — EUR öne çıkar
  document.getElementById('ozetKasa').innerHTML = `
    <div class="ozet-row" style="background:rgba(16,185,129,.06);border-radius:8px;padding:10px 6px;margin-bottom:8px;border-bottom:none">
      <span style="font-weight:800;font-size:14px">🇪🇺 Toplam EUR</span>
      <span class="${(bakiye.EUR||0)>=0?'amount-pos':'amount-neg'}" style="font-size:20px;font-weight:800;font-family:var(--mono)">€${fmt(Math.abs(bakiye.EUR||0))}</span>
    </div>
    ${['TL','USD','GBP','RUB'].map(p => {
      const b = bakiye[p]||0;
      if (b === 0 && p !== 'TL') return '';
      return `<div class="ozet-row">
        <span class="ozet-label">${flag[p]} ${p} Bakiye</span>
        <span class="${b>=0?'amount-pos':'amount-neg'} ozet-val">${symMap[p]}${fmt(Math.abs(b))}</span>
      </div>`;
    }).join('')}
    <div class="ozet-row" style="border-top:2px solid var(--border);margin-top:8px;padding-top:10px">
      <span class="ozet-label">Toplam Gider (TL)</span>
      <span class="amount-neg ozet-val">${fmt(topGider)} ₺</span>
    </div>`;

  // Döviz detay
  document.getElementById('ozetDoviz').innerHTML = ['EUR','USD','GBP','RUB'].map(c => {
    const g = giris[c]||0, ci = cikis[c]||0, b = bakiye[c]||0;
    if (g === 0 && ci === 0) return `<div class="ozet-row"><span class="ozet-label">${flag[c]} ${c}</span><span style="color:var(--text3)">Hareket yok</span></div>`;
    return `<div class="ozet-row">
      <span class="ozet-label">${flag[c]} ${c}</span>
      <div style="text-align:right">
        <div class="${b>=0?'amount-pos':'amount-neg'} ozet-val">${symMap[c]}${fmt(Math.abs(b))}</div>
        <div style="font-size:10px;color:var(--text3)">Giriş: ${symMap[c]}${fmt(g)} · Çıkış: ${symMap[c]}${fmt(ci)}</div>
      </div>
    </div>`;
  }).join('');

  // Borç
  const borcEl = document.getElementById('ozetBorc');
  if (!state.toptancilar.length) { borcEl.innerHTML = '<div class="empty"><div class="icon">🏭</div><p>Toptancı yok</p></div>'; }
  else {
    const today = todayStr();
    const eurKur = kurlar.EUR || 1;
    const toEUR = (tutar, para) => {
      if (para==='EUR') return tutar;
      if (para==='TL')  return tutar / eurKur;
      if (para==='USD') return tutar * (kurlar.USD||1) / eurKur;
      if (para==='GBP') return tutar * (kurlar.GBP||1) / eurKur;
      return tutar / eurKur;
    };
    const yontemLabel = { nakit:'💵 Nakit', kredi:'💳 Kredi', senet:'📄 Senet', havale:'🏦 Havale' };

    let genelToplamEUR = 0;

    const satirlar = state.toptancilar.map(t => {
      const bakiyeByPara = getToptanciBakiyeByPara(t.id);
      // EUR eşdeğeri hesapla
      const toplamEUR = Object.entries(bakiyeByPara).reduce((s,[p,v])=>s+toEUR(v,p),0);
      genelToplamEUR += toplamEUR;

      // Para birimi bazında satırlar
      const borcSatirlar = Object.entries(bakiyeByPara)
        .filter(([,v]) => Math.abs(v) > 0.001)
        .map(([p,v]) => `<span style="font-size:11px;color:var(--text2)">${SYM[p]||''}${fmt(Math.abs(v))} ${p}</span>`)
        .join(' · ') || '';

      // İleri vadeli ödemeler
      const ileriOdemeler = state.toptanciIslemler.filter(i =>
        i.toptanciId === t.id &&
        (i.tur === 'odeme' || i.tur === 'iade') &&
        i.odemeVade && i.odemeVade >= today
      );
      let ileriHtml = '';
      if (ileriOdemeler.length) {
        ileriHtml = `<div style="margin-top:6px;padding:6px 8px;background:rgba(16,185,129,.07);border-radius:8px;border-left:3px solid var(--green)">
          <div style="font-size:10px;font-weight:700;color:var(--green);margin-bottom:3px">📅 Vadeli Ödemeler</div>
          ${ileriOdemeler.map(i => {
            const gunKaldi = dayDiff(today, i.odemeVade);
            const gecti = i.odemeVade < today;
            return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0">
              <span>${yontemLabel[i.odemeYontemi]||'Ödeme'} — ${SYM[i.para]||''}${fmt(i.tutar)} ${i.para||'TL'}</span>
              <span style="font-weight:700;color:${gecti?'var(--red)':'var(--accent)'}">${formatDate(i.odemeVade)} · ${gecti?Math.abs(gunKaldi)+' gün gecikti':gunKaldi+' gün kaldı'}</span>
            </div>`;
          }).join('')}
        </div>`;
      }

      const durum = Math.abs(toplamEUR) < 0.01
        ? `<span style="color:var(--green);font-weight:800;font-size:13px">✅ Borç Yok</span>`
        : toplamEUR > 0
          ? `<div style="text-align:right">
               <div style="font-size:16px;font-weight:800;color:var(--red)">📛 €${fmt(toplamEUR)}</div>
               ${borcSatirlar ? `<div style="margin-top:2px">${borcSatirlar}</div>` : ''}
             </div>`
          : `<div style="text-align:right">
               <div style="font-size:16px;font-weight:800;color:var(--green)">✅ €${fmt(Math.abs(toplamEUR))} alacak</div>
               ${borcSatirlar ? `<div style="margin-top:2px">${borcSatirlar}</div>` : ''}
             </div>`;

      return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div class="ozet-row" style="border:none;padding:0;margin-bottom:${ileriOdemeler.length?'6':'0'}px">
          <span class="ozet-label" style="font-weight:700;font-size:14px">${t.adi}</span>
          ${durum}
        </div>
        ${ileriHtml}
      </div>`;
    }).join('');

    // Genel toplam kutusu
    const genelRenk = genelToplamEUR > 0.01 ? 'var(--red)' : genelToplamEUR < -0.01 ? 'var(--green)' : 'var(--text2)';
    const genelLabel = genelToplamEUR > 0.01 ? '📛 Toplam Borç' : genelToplamEUR < -0.01 ? '✅ Toplam Alacak' : '✅ Net Sıfır';
    const genelBox = `
      <div style="background:${genelToplamEUR>0.01?'rgba(244,63,94,.08)':genelToplamEUR<-0.01?'rgba(16,185,129,.08)':'rgba(0,0,0,.04)'};border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.05em">${genelLabel}</span>
        <span style="font-size:22px;font-weight:800;color:${genelRenk}">€${fmt(Math.abs(genelToplamEUR))}</span>
      </div>
      ${eurKur>1?`<div style="font-size:10px;color:var(--text3);margin-bottom:8px">* 1 EUR = ${fmt(eurKur)} ₺ kuru ile hesaplandı</div>`:''}`;

    borcEl.innerHTML = genelBox + satirlar;
  }

  // Gider dağılım
  const turToplam = {};
  state.giderler.forEach(g => { turToplam[g.tur] = (turToplam[g.tur]||0) + g.tutar; });
  const toplam = Object.values(turToplam).reduce((s,v)=>s+v,0);
  const turEmoji = { Kira:'🏠',Elektrik:'💡',Su:'💧','Doğalgaz':'🔥','İnternet':'📶',Personel:'👤',Vergi:'📑',Nakliye:'🚚','Diğer':'📌' };
  document.getElementById('ozetGider').innerHTML = !toplam ? '<div class="empty"><div class="icon">📋</div><p>Gider kaydı yok</p></div>' :
    Object.entries(turToplam).sort((a,b)=>b[1]-a[1]).map(([tur,v]) => `
      <div class="ozet-row">
        <span class="ozet-label">${turEmoji[tur]||'📌'} ${tur}</span>
        <div style="text-align:right">
          <span class="ozet-val amount-neg">${fmt(v)} ₺</span>
          <div style="font-size:10px;color:var(--text3)">${Math.round(v/toplam*100)}%</div>
        </div>
      </div>`).join('');
}

// ===== MANUEL KUR =====
// ===== KUR PANEL =====
function openKurPanel() {
  const panel = document.getElementById('manuelKurPanel');
  panel.style.display = 'block';
  document.getElementById('manuelKurBody').style.display = 'block';
}
function closeKurPanel() {
  document.getElementById('manuelKurPanel').style.display = 'none';
}
function toggleKurPanel() {
  const body = document.getElementById('manuelKurBody');
  const btn = document.querySelector('#manuelKurHeader button');
  if (body.style.display === 'none') {
    body.style.display = 'block';
    document.querySelector('#manuelKurHeader button').textContent = '−';
  } else {
    body.style.display = 'none';
    document.querySelector('#manuelKurHeader button').textContent = '+';
  }
}

// Drag support
(function() {
  let isDragging = false, startX, startY, startLeft, startBottom;
  const header = document.getElementById('manuelKurHeader');
  if (!header) return;
  header.addEventListener('mousedown', e => {
    const panel = document.getElementById('manuelKurPanel');
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left;
    startBottom = window.innerHeight - rect.bottom;
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', () => { isDragging = false; document.removeEventListener('mousemove', onDrag); });
  });
  function onDrag(e) {
    if (!isDragging) return;
    const panel = document.getElementById('manuelKurPanel');
    const dx = e.clientX - startX, dy = e.clientY - startY;
    panel.style.left = Math.max(0, startLeft + dx) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = Math.max(0, startBottom - dy) + 'px';
  }
})();

function saveManuelKur() {
  const usd = parseFloat(document.getElementById('mKurUSD').value);
  const eur = parseFloat(document.getElementById('mKurEUR').value);
  const gbp = parseFloat(document.getElementById('mKurGBP').value);
  const rub = parseFloat(document.getElementById('mKurRUB').value);
  if (!usd || !eur || !gbp) { showToast('En az USD, EUR ve GBP girin', 'error'); return; }
  kurlar.USD = usd; kurlar.EUR = eur; kurlar.GBP = gbp; kurlar.RUB = rub || 0;
  kurlar.updated = new Date().toLocaleTimeString('tr-TR') + ' (Manuel)';
  saveKurlar(); renderKurBar(); updateKasaKur(); renderStats();
  closeKurPanel();
  showToast('Kurlar manuel olarak güncellendi ✓');
}

// ===== RAPOR =====
let raporDon = 'ay';

function setRaporDon(don, btn) {
  raporDon = don;
  document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('raporOzelAralik').style.display = don === 'ozel' ? 'block' : 'none';
  if (don !== 'ozel') renderRapor();
}

function getRaporAralik() {
  const today = new Date();
  let bas, bit;
  if (raporDon === 'hafta') {
    const day = today.getDay() || 7;
    bas = new Date(today); bas.setDate(today.getDate() - day + 1);
    bit = new Date(today); bit.setDate(today.getDate() + (7 - day));
  } else if (raporDon === 'ay') {
    bas = new Date(today.getFullYear(), today.getMonth(), 1);
    bit = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (raporDon === 'yil') {
    bas = new Date(today.getFullYear(), 0, 1);
    bit = new Date(today.getFullYear(), 11, 31);
  } else {
    const b = document.getElementById('raporBaslangic').value;
    const bi = document.getElementById('raporBitis').value;
    if (!b || !bi) return null;
    bas = new Date(b); bit = new Date(bi);
  }
  return { bas: bas.toISOString().split('T')[0], bit: bit.toISOString().split('T')[0] };
}

function inAralik(tarih, bas, bit) { return tarih >= bas && tarih <= bit; }

function renderRapor() {
  const aralik = getRaporAralik();
  if (!aralik) { showToast('Tarih aralığı seçin', 'error'); return; }
  const { bas, bit } = aralik;
  const labels = { hafta: 'Bu Hafta', ay: 'Bu Ay', yil: 'Bu Yıl', ozel: 'Seçili Aralık' };
  document.getElementById('raporBaslikBilgi').textContent =
    `${labels[raporDon]}  •  ${formatDate(bas)} – ${formatDate(bit)}`;

  const kasaRows   = state.kasa.filter(k => inAralik(k.tarih, bas, bit));
  const giderRows  = state.giderler.filter(g => inAralik(g.tarih, bas, bit));
  const islemRows  = state.toptanciIslemler.filter(i => inAralik(i.tarih, bas, bit));
  const satisRows  = satislarCache.filter(s => {
    const t = (s.tarih||'').split('T')[0]; return t >= bas && t <= bit;
  });

  const sym = {EUR:'€',TL:'₺',USD:'$',GBP:'£',RUB:'₽'};

  // ── Satış geliri (EUR) ──
  const satisEUR = satisRows.reduce((s,x)=>s+(x.total||0),0);

  // ── Kasa girişleri/çıkışları — para birimi bazında ──
  const kasaGiris = {}, kasaCikis = {};
  kasaRows.forEach(k => {
    const p = k.para||'TL';
    if (k.tur==='giris') kasaGiris[p] = (kasaGiris[p]||0) + k.tutar;
    else kasaCikis[p] = (kasaCikis[p]||0) + k.tutar;
  });

  // ── Giderler — para birimi bazında ──
  const giderByPara = {};
  giderRows.forEach(g => {
    const p = g.para||'TL';
    giderByPara[p] = (giderByPara[p]||0) + g.tutar;
  });

  // ── Toptancı — para birimi bazında ──
  const toptanciAlisByPara = {}, toptanciOdemeByPara = {};
  islemRows.forEach(i => {
    const p = i.para||'TL';
    if (i.tur==='alis') toptanciAlisByPara[p] = (toptanciAlisByPara[p]||0) + i.tutar;
    else toptanciOdemeByPara[p] = (toptanciOdemeByPara[p]||0) + i.tutar;
  });

  // ── Net bilanço — EUR üzerinden (kur ile) ──
  const eurKur = kurlar.EUR || 1;
  const tlKur  = 1;
  const toEUR  = (tutar, para) => {
    if (para==='EUR') return tutar;
    if (para==='TL')  return tutar / eurKur;
    if (para==='USD') return tutar * (kurlar.USD||1) / eurKur;
    if (para==='GBP') return tutar * (kurlar.GBP||1) / eurKur;
    return tutar / eurKur;
  };

  // Toplam gelir (EUR eşdeğeri)
  const gelirEUR = satisEUR +
    Object.entries(kasaGiris).reduce((s,[p,v])=>s+toEUR(v,p),0);
  // Toplam gider (EUR eşdeğeri)
  const giderEUR = Object.entries(giderByPara).reduce((s,[p,v])=>s+toEUR(v,p),0) +
    Object.entries(kasaCikis).reduce((s,[p,v])=>s+toEUR(v,p),0);
  // Toptancıya ödeme (EUR eşdeğeri) — borç değil, fiili ödeme
  const toptanciOdemeEUR = Object.entries(toptanciOdemeByPara).reduce((s,[p,v])=>s+toEUR(v,p),0);
  const netEUR = gelirEUR - giderEUR - toptanciOdemeEUR;

  // ── Stat kartları ──
  document.getElementById('raporStatlar').innerHTML = `
    <div class="stat-card green">
      <div class="stat-icon">📈</div>
      <div class="stat-label">Toplam Gelir</div>
      <div class="stat-value green">€${fmt(gelirEUR)}</div>
      <div class="stat-sub">Satış + Kasa girişleri</div>
    </div>
    <div class="stat-card red">
      <div class="stat-icon">📉</div>
      <div class="stat-label">Toplam Gider</div>
      <div class="stat-value red">€${fmt(giderEUR)}</div>
      <div class="stat-sub">Giderler + Kasa çıkışları</div>
    </div>
    <div class="stat-card yellow">
      <div class="stat-icon">🏭</div>
      <div class="stat-label">Toptancı Ödemeleri</div>
      <div class="stat-value">€${fmt(toptanciOdemeEUR)}</div>
      <div class="stat-sub">${islemRows.filter(i=>i.tur!=='alis').length} işlem</div>
    </div>
    <div class="stat-card ${netEUR>=0?'blue':'red'}">
      <div class="stat-icon">${netEUR>=0?'✅':'⚠️'}</div>
      <div class="stat-label">Net Bilanço</div>
      <div class="stat-value ${netEUR>=0?'green':'red'}">€${fmt(netEUR)}</div>
      <div class="stat-sub">Gelir − Gider − Toptancı</div>
    </div>
  `;

  // ── Detaylı net bilanço kartı ──
  const bilancoParagraphs = (label, byPara, sign) =>
    Object.entries(byPara).filter(([,v])=>v>0.001).map(([p,v]) =>
      `<div class="ozet-row">
        <span class="ozet-label" style="padding-left:12px;font-size:12px">↳ ${label} ${p}</span>
        <span class="${sign>0?'amount-pos':'amount-neg'} ozet-val">${sign>0?'+':'−'}${sym[p]||''}${fmt(v)}</span>
      </div>`).join('');

  document.getElementById('raporKasa').innerHTML = `
    <!-- GELİRLER -->
    <div style="font-size:11px;font-weight:800;color:var(--green);text-transform:uppercase;letter-spacing:.06em;padding:6px 0 4px">📈 Gelirler</div>
    ${satisEUR>0?`<div class="ozet-row"><span class="ozet-label">🛍 Satış Geliri</span><span class="amount-pos ozet-val">€${fmt(satisEUR)}</span></div>`:''}
    ${bilancoParagraphs('Kasa Giriş', kasaGiris, 1)}
    ${(!satisEUR && !Object.keys(kasaGiris).length)?'<div style="font-size:12px;color:var(--text3);padding:4px 0">— Gelir yok —</div>':''}

    <!-- GİDERLER -->
    <div style="font-size:11px;font-weight:800;color:var(--red);text-transform:uppercase;letter-spacing:.06em;padding:10px 0 4px">📉 Giderler & Çıkışlar</div>
    ${bilancoParagraphs('Gider', giderByPara, -1)}
    ${bilancoParagraphs('Kasa Çıkış', kasaCikis, -1)}
    ${(!Object.keys(giderByPara).length && !Object.keys(kasaCikis).length)?'<div style="font-size:12px;color:var(--text3);padding:4px 0">— Gider yok —</div>':''}

    <!-- TOPTANCI ÖDEMELERİ -->
    ${Object.keys(toptanciOdemeByPara).length?`
    <div style="font-size:11px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;padding:10px 0 4px">🏭 Toptancı Ödemeleri</div>
    ${bilancoParagraphs('Ödeme', toptanciOdemeByPara, -1)}`:''}

    <!-- NET -->
    <div style="border-top:2px solid var(--border);margin-top:12px;padding-top:12px">
      <div class="ozet-row">
        <span style="font-weight:800;font-size:14px">🧮 Net Bilanço (EUR eşd.)</span>
        <span style="font-size:20px;font-weight:800;color:${netEUR>=0?'var(--green)':'var(--red)'}">€${fmt(netEUR)}</span>
      </div>
      ${eurKur>1?`<div style="font-size:10px;color:var(--text3);text-align:right;margin-top:2px">1 EUR = ${fmt(eurKur)} ₺ kuru kullanıldı</div>`:''}
    </div>
  `;

  // ── Gider dağılımı ──
  const turToplam = {};
  giderRows.forEach(g => { turToplam[g.tur] = (turToplam[g.tur]||0) + g.tutar; });
  const topGider = Object.values(turToplam).reduce((s,v)=>s+v,0);
  const turEmoji = { Muhasebe:'📑',Gün:'📅',Market:'🛒',Kira:'🏠',Elektrik:'💡',Su:'💧','Doğalgaz':'🔥','İnternet':'📶',Personel:'👥',Vergi:'🧾',Nakliye:'🚚','Diğer':'📌' };
  document.getElementById('raporGider').innerHTML = !topGider
    ? '<div class="empty"><div class="icon">📋</div><p>Bu dönemde gider yok</p></div>'
    : Object.entries(turToplam).sort((a,b)=>b[1]-a[1]).map(([tur,v]) => `
        <div class="ozet-row">
          <span class="ozet-label">${turEmoji[tur]||'📌'} ${tur}</span>
          <div style="text-align:right">
            <span class="ozet-val amount-neg">${fmt(v)}</span>
            <div style="font-size:10px;color:var(--text3)">${Math.round(v/topGider*100)}%</div>
          </div>
        </div>`).join('');

  // ── Toptancı detayı ──
  const topAlis   = Object.values(toptanciAlisByPara).reduce((s,v)=>s+v,0);
  const topOdeme  = Object.values(toptanciOdemeByPara).reduce((s,v)=>s+v,0);
  document.getElementById('raporToptanci').innerHTML = !islemRows.length
    ? '<div class="empty"><div class="icon">🏭</div><p>Bu dönemde hareket yok</p></div>'
    : Object.entries(toptanciAlisByPara).map(([p,v])=>
        `<div class="ozet-row"><span class="ozet-label">🛒 Alış ${p}</span><span class="amount-neg ozet-val">${sym[p]||''}${fmt(v)}</span></div>`).join('')
      + Object.entries(toptanciOdemeByPara).map(([p,v])=>
        `<div class="ozet-row"><span class="ozet-label">💳 Ödeme ${p}</span><span class="amount-pos ozet-val">${sym[p]||''}${fmt(v)}</span></div>`).join('')
      + state.toptancilar.map(t => {
          const rows = islemRows.filter(i=>i.toptanciId===t.id);
          if (!rows.length) return '';
          const alisByPara={}, odemByPara={};
          rows.forEach(i => {
            const p=i.para||'TL';
            if(i.tur==='alis') alisByPara[p]=(alisByPara[p]||0)+i.tutar;
            else odemByPara[p]=(odemByPara[p]||0)+i.tutar;
          });
          const aliStr = Object.entries(alisByPara).map(([p,v])=>`A:${sym[p]||''}${fmt(v)}`).join(' ');
          const oStr   = Object.entries(odemByPara).map(([p,v])=>`Ö:${sym[p]||''}${fmt(v)}`).join(' ');
          return `<div class="ozet-row" style="border-top:1px solid var(--border);margin-top:4px;padding-top:8px">
            <span class="ozet-label" style="font-size:12px;font-weight:700">${t.adi}</span>
            <span style="font-size:11px;color:var(--text2)">${[aliStr,oStr].filter(Boolean).join(' / ')}</span>
          </div>`;
        }).join('');

  // ── Döviz hareketleri ──
  const dovizDetay = {};
  kasaRows.filter(k=>k.para!=='TL').forEach(k => {
    if (!dovizDetay[k.para]) dovizDetay[k.para] = { giris:0, cikis:0 };
    k.tur==='giris' ? dovizDetay[k.para].giris+=k.tutar : dovizDetay[k.para].cikis+=k.tutar;
  });
  const flagMap = {USD:'🇺🇸',EUR:'🇪🇺',GBP:'🇬🇧',RUB:'🇷🇺'};
  document.getElementById('raporDoviz').innerHTML = !Object.keys(dovizDetay).length
    ? '<div class="empty"><div class="icon">🌍</div><p>Bu dönemde döviz hareketi yok</p></div>'
    : Object.entries(dovizDetay).map(([c,d]) => `
        <div class="ozet-row">
          <span class="ozet-label">${flagMap[c]||''} ${c}</span>
          <div style="text-align:right;font-size:12px">
            <span class="amount-pos">+${sym[c]||''}${fmt(d.giris)}</span>
            <span style="color:var(--text3);margin:0 4px">/</span>
            <span class="amount-neg">−${sym[c]||''}${fmt(d.cikis)}</span>
          </div>
        </div>`).join('');

  // ── Kasa detay tablosu ──
  const tbody = document.getElementById('raporKasaDetay');
  tbody.innerHTML = !kasaRows.length
    ? `<tr><td colspan="6"><div class="empty"><div class="icon">💰</div><p>Bu dönemde kasa hareketi yok</p></div></td></tr>`
    : kasaRows.map(k => `<tr>
        <td>${formatDate(k.tarih)}</td>
        <td><span class="badge ${k.tur==='giris'?'badge-green':'badge-red'}">${k.tur==='giris'?'📈 Giriş':'📉 Çıkış'}</span></td>
        <td class="${k.tur==='giris'?'amount-pos':'amount-neg'}">${k.tur==='giris'?'+':'−'}${fmt(k.tutar)}</td>
        <td><span class="badge badge-blue">${k.para}</span></td>
        <td class="amount">${fmt(k.tutar * (k.kur||1))} ₺</td>
        <td style="color:var(--text2)">${k.aciklama||'—'}</td>
      </tr>`).join('');
}

function printRapor() {
  const aralik = getRaporAralik();
  if (!aralik) return;
  window.print();
}

// ===== ORTAKLAR =====
const ORTAK_TUR_LABEL = {
  avans: '💸 Avans Çekme',
  sermaye: '💰 Sermaye Koyma',
  kisisel_borc: '🧾 Kişisel Borç',
  calisan: '👷 Çalışan Ödemesi',
  vergi: '📑 Vergi',
  kar_dagilim: '🎯 Kâr Dağılımı'
};

// Kasayı etkileyen işlemler: avans/kisisel_borc/calisan/vergi kasadan çıkar, sermaye/kar_dagilim kasaya girer (negatif)
const ORTAK_KASA_ETKI = {
  avans: 'cikis', sermaye: 'giris', kisisel_borc: 'cikis',
  calisan: 'cikis', vergi: 'cikis', kar_dagilim: 'cikis'
};

function ortakAdKaydet() {
  const ad1 = document.getElementById('ortak1Ad').value.trim();
  const ad2 = document.getElementById('ortak2Ad').value.trim();
  if (!ad1 || !ad2) { showToast('Her iki ortak için ad girin', 'error'); return; }
  state.ortaklar[0].ad = ad1;
  state.ortaklar[1].ad = ad2;
  save(); renderOrtakSayfasi();
  showToast('Ortak adları kaydedildi ✓');
}

function updateOrtakKur() {
  const para = document.getElementById('ortakPara').value;
  const group = document.getElementById('ortakKurGroup');
  const kurInput = document.getElementById('ortakKur');
  if (para === 'TL') { group.style.display = 'none'; }
  else { group.style.display = ''; kurInput.value = (kurlar[para]||0).toFixed(2); }
}

function updateOrtakIslemUI() {
  const tur = document.getElementById('ortakIslemTur').value;
  const lbl = document.getElementById('ortakAciklamaLabel');
  const inp = document.getElementById('ortakAciklama');
  if (tur === 'calisan') { lbl.textContent = 'Çalışan Adı'; inp.placeholder = 'Çalışanın adı...'; }
  else if (tur === 'kisisel_borc') { lbl.textContent = 'Borç / Alacaklı'; inp.placeholder = 'Kime ödendi?'; }
  else if (tur === 'vergi') { lbl.textContent = 'Vergi Türü'; inp.placeholder = 'KDV, gelir vergisi...'; }
  else { lbl.textContent = 'Açıklama'; inp.placeholder = 'Açıklama...'; }
}

function ortakIslemEkle() {
  const ortakId = document.getElementById('islemOrtak').value;
  const tur = document.getElementById('ortakIslemTur').value;
  const para = document.getElementById('ortakPara').value;
  const tutar = parseFloat(document.getElementById('ortakTutar').value);
  const aciklama = document.getElementById('ortakAciklama').value.trim();
  const tarih = document.getElementById('ortakTarih').value;
  const kur = para === 'TL' ? 1 : parseFloat(document.getElementById('ortakKur').value) || 0;

  if (!tutar || tutar <= 0) { showToast('Geçerli tutar girin', 'error'); return; }
  if (!tarih) { showToast('Tarih seçin', 'error'); return; }
  if (para !== 'TL' && !kur) { showToast('Kur girin', 'error'); return; }

  state.ortakIslemler.push({ id: Date.now(), ortakId, tur, para, tutar, kur, aciklama, tarih });
  state.ortakIslemler.sort((a,b) => b.tarih.localeCompare(a.tarih));
  save();

  document.getElementById('ortakTutar').value = '';
  document.getElementById('ortakAciklama').value = '';
  renderOrtakSayfasi(); renderStats(); renderOzet();
  showToast('Hareket eklendi ✓');
}

function ortakIslemSil(id) {
  if (!confirm('Bu hareketi silmek istiyor musunuz?')) return;
  state.ortakIslemler = state.ortakIslemler.filter(i => i.id !== id);
  save(); renderOrtakSayfasi(); renderStats(); renderOzet();
  showToast('Silindi');
}

function getOrtakBakiye(ortakId) {
  // Pozitif = ortağın işletmeye borcu (fazla avans aldı)
  // Negatif = işletmenin ortağa borcu (fazla sermaye koydu)
  return state.ortakIslemler.filter(i => i.ortakId === ortakId).reduce((s, i) => {
    const tlk = i.tutar * i.kur;
    const etki = ORTAK_KASA_ETKI[i.tur];
    return etki === 'cikis' ? s + tlk : s - tlk;
  }, 0);
}

function renderOrtakBakiyeKartlar() {
  const el = document.getElementById('ortakBakiyeKartlar');
  el.innerHTML = state.ortaklar.map(o => {
    const bakiye = getOrtakBakiye(o.id);
    const topAvans = state.ortakIslemler.filter(i=>i.ortakId===o.id&&i.tur==='avans').reduce((s,i)=>s+i.tutar*i.kur,0);
    const topSermaye = state.ortakIslemler.filter(i=>i.ortakId===o.id&&i.tur==='sermaye').reduce((s,i)=>s+i.tutar*i.kur,0);
    const topBorc = state.ortakIslemler.filter(i=>i.ortakId===o.id&&i.tur==='kisisel_borc').reduce((s,i)=>s+i.tutar*i.kur,0);
    const topCalisan = state.ortakIslemler.filter(i=>i.ortakId===o.id&&i.tur==='calisan').reduce((s,i)=>s+i.tutar*i.kur,0);
    const topVergi = state.ortakIslemler.filter(i=>i.ortakId===o.id&&i.tur==='vergi').reduce((s,i)=>s+i.tutar*i.kur,0);
    return `<div class="stat-card ${bakiye > 0 ? 'red' : 'green'}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div class="borc-avatar" style="width:42px;height:42px;font-size:18px">${o.ad[0]}</div>
        <div>
          <div style="font-size:16px;font-weight:800">${o.ad}</div>
          <div style="font-size:11px;color:var(--text2)">Eşit ortaklık (%50)</div>
        </div>
      </div>
      <div class="ozet-row"><span class="ozet-label">💸 Avans Çekme</span><span class="amount-neg">${fmt(topAvans)} ₺</span></div>
      <div class="ozet-row"><span class="ozet-label">💰 Sermaye Koyma</span><span class="amount-pos">${fmt(topSermaye)} ₺</span></div>
      <div class="ozet-row"><span class="ozet-label">🧾 Kişisel Borç</span><span class="amount-neg">${fmt(topBorc)} ₺</span></div>
      <div class="ozet-row"><span class="ozet-label">👷 Çalışan Öd.</span><span class="amount-neg">${fmt(topCalisan)} ₺</span></div>
      <div class="ozet-row"><span class="ozet-label">📑 Vergi</span><span class="amount-neg">${fmt(topVergi)} ₺</span></div>
      <div class="ozet-row" style="border-top:2px solid var(--border);margin-top:6px;padding-top:10px">
        <span style="font-weight:800">Net Durum</span>
        <div style="text-align:right">
          <div class="${bakiye>0?'amount-neg':'amount-pos'}" style="font-size:16px;font-weight:800">${fmt(Math.abs(bakiye))} ₺</div>
          <div style="font-size:10px;color:var(--text3)">${bakiye>0?'İşletmeden alacaklı':'İşletmeye borçlu'}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderOrtakIslemler() {
  const filter = document.getElementById('ortakFilter').value;
  let rows = filter ? state.ortakIslemler.filter(i => i.ortakId === filter) : state.ortakIslemler;
  const tbody = document.getElementById('ortakIslemTable');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="icon">🤝</div><p>Henüz hareket yok</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(i => {
    const o = state.ortaklar.find(o => o.id === i.ortakId);
    const tlk = i.tutar * i.kur;
    const etki = ORTAK_KASA_ETKI[i.tur];
    return `<tr>
      <td>${formatDate(i.tarih)}</td>
      <td style="font-weight:700">${o ? o.ad : '?'}</td>
      <td><span class="badge ${etki==='cikis'?'badge-red':'badge-green'}">${ORTAK_TUR_LABEL[i.tur]||i.tur}</span></td>
      <td class="${etki==='cikis'?'amount-neg':'amount-pos'}">${etki==='cikis'?'−':'+'}${fmt(i.tutar)}</td>
      <td><span class="badge badge-blue">${i.para}</span></td>
      <td class="amount">${fmt(tlk)} ₺</td>
      <td style="color:var(--text2)">${i.aciklama||'—'}</td>
      <td><button class="btn btn-danger btn-icon btn-sm" onclick="ortakIslemSil(${i.id})">🗑</button></td>
    </tr>`;
  }).join('');
}

function renderOrtakFilter() {
  const sel = document.getElementById('ortakFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tüm Ortaklar</option>' +
    state.ortaklar.map(o => `<option value="${o.id}" ${o.id===cur?'selected':''}>${o.ad}</option>`).join('');
  const sel2 = document.getElementById('islemOrtak');
  sel2.innerHTML = state.ortaklar.map(o => `<option value="${o.id}">${o.ad}</option>`).join('');
}

function renderOrtakSayfasi() {
  document.getElementById('ortak1Ad').value = state.ortaklar[0]?.ad || '';
  document.getElementById('ortak2Ad').value = state.ortaklar[1]?.ad || '';
  renderOrtakBakiyeKartlar();
  renderOrtakFilter();
  renderOrtakIslemler();
}

// ===== KÂR / ZARAR =====
let kzDon = 'toplam';

function setKZDon(don, btn) {
  kzDon = don;
  document.querySelectorAll('#page-karzarar .tab-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const ozel = document.getElementById('kzOzelAralik');
  ozel.style.display = don === 'ozel' ? 'flex' : 'none';
  if (don !== 'ozel') renderKarZarar();
}

function getKZAralik() {
  const today = new Date();
  if (kzDon === 'toplam') {
    // Find earliest date in all data
    const allDates = [
      ...state.kasa.map(k=>k.tarih),
      ...state.giderler.map(g=>g.tarih),
      ...state.toptanciIslemler.map(i=>i.tarih)
    ].filter(Boolean).sort();
    const bas = allDates.length ? allDates[0] : today.toISOString().split('T')[0];
    return { bas, bit: today.toISOString().split('T')[0], label: 'Tüm Zamanlar' };
  }
  if (kzDon === 'yil') {
    return { bas: `${today.getFullYear()}-01-01`, bit: `${today.getFullYear()}-12-31`, label: `${today.getFullYear()} Yılı` };
  }
  if (kzDon === 'ay') {
    const m = String(today.getMonth()+1).padStart(2,'0');
    const lastDay = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
    return { bas: `${today.getFullYear()}-${m}-01`, bit: `${today.getFullYear()}-${m}-${lastDay}`, label: `${today.toLocaleString('tr-TR',{month:'long'})} ${today.getFullYear()}` };
  }
  if (kzDon === 'hafta') {
    const day = today.getDay() || 7;
    const bas = new Date(today); bas.setDate(today.getDate() - day + 1);
    const bit = new Date(today); bit.setDate(today.getDate() + (7 - day));
    return { bas: bas.toISOString().split('T')[0], bit: bit.toISOString().split('T')[0], label: 'Bu Hafta' };
  }
  if (kzDon === 'ozel') {
    const b = document.getElementById('kzBas').value;
    const bi = document.getElementById('kzBit').value;
    if (!b || !bi) return null;
    return { bas: b, bit: bi, label: `${formatDate(b)} – ${formatDate(bi)}` };
  }
  return null;
}

function calcKZ(bas, bit) {
  const inR = t => t >= bas && t <= bit;
  // Gelir: kasa girişleri (TL karşılığı)
  const gelir = state.kasa.filter(k=>k.tur==='giris'&&inR(k.tarih)).reduce((s,k)=>s+k.tutar*k.kur, 0);
  // Kasa çıkış (satış iadesi gibi normal çıkışlar — toptancı/ortak/gider hariç)
  const kasaCikis = state.kasa.filter(k=>k.tur==='cikis'&&inR(k.tarih)).reduce((s,k)=>s+k.tutar*k.kur, 0);
  // Toptancı alışları (maliyet)
  const maliyet = state.toptanciIslemler.filter(i=>i.tur==='alis'&&inR(i.tarih)).reduce((s,i)=>s+i.tutar, 0);
  // Giderler
  const gider = state.giderler.filter(g=>inR(g.tarih)).reduce((s,g)=>s+g.tutar, 0);
  // Ortak işlemleri (sadece vergi ve çalışan — bunlar gider sayılır)
  const ortakGider = state.ortakIslemler.filter(i=>['vergi','calisan'].includes(i.tur)&&inR(i.tarih)).reduce((s,i)=>s+i.tutar*i.kur,0);

  const brutKar = gelir - kasaCikis - maliyet;
  const netKar = brutKar - gider - ortakGider;
  return { gelir, kasaCikis, maliyet, gider, ortakGider, brutKar, netKar };
}

function renderKarZarar() {
  const aralik = getKZAralik();
  if (!aralik) { showToast('Tarih aralığı seçin', 'error'); return; }
  const { bas, bit, label } = aralik;
  const birikimli = document.getElementById('kzBirikimli').checked;

  document.getElementById('kzBaslikBilgi').textContent = `${label}  •  ${formatDate(bas)} – ${formatDate(bit)}`;

  const kz = calcKZ(bas, bit);

  // Stats
  const netColor = kz.netKar >= 0 ? 'green' : 'red';
  const brutColor = kz.brutKar >= 0 ? 'blue' : 'red';
  document.getElementById('kzStatlar').innerHTML = `
    <div class="stat-card green">
      <div class="stat-icon">💰</div>
      <div class="stat-label">Toplam Gelir</div>
      <div class="stat-value green">${fmt(kz.gelir)} ₺</div>
      <div class="stat-sub">Kasa girişleri</div>
    </div>
    <div class="stat-card red">
      <div class="stat-icon">🛒</div>
      <div class="stat-label">Toplam Maliyet</div>
      <div class="stat-value red">${fmt(kz.maliyet)} ₺</div>
      <div class="stat-sub">Toptancı alışları</div>
    </div>
    <div class="stat-card ${brutColor}">
      <div class="stat-icon">📊</div>
      <div class="stat-label">Brüt Kâr</div>
      <div class="stat-value ${kz.brutKar>=0?'':'red'}">${fmt(kz.brutKar)} ₺</div>
      <div class="stat-sub">Gelir − Maliyet</div>
    </div>
    <div class="stat-card ${netColor}">
      <div class="stat-icon">${kz.netKar>=0?'✅':'⚠️'}</div>
      <div class="stat-label">Net Kâr</div>
      <div class="stat-value ${kz.netKar>=0?'green':'red'}">${fmt(kz.netKar)} ₺</div>
      <div class="stat-sub">Her ortağa: ${fmt(kz.netKar/2)} ₺</div>
    </div>
  `;

  // Gelir/Gider özeti
  const margin = kz.gelir > 0 ? (kz.brutKar / kz.gelir * 100).toFixed(1) : 0;
  const netMargin = kz.gelir > 0 ? (kz.netKar / kz.gelir * 100).toFixed(1) : 0;
  document.getElementById('kzGelirGider').innerHTML = `
    <div class="ozet-row"><span class="ozet-label">💰 Kasa Girişleri</span><span class="amount-pos ozet-val">${fmt(kz.gelir)} ₺</span></div>
    <div class="ozet-row"><span class="ozet-label">📉 Kasa Çıkışları</span><span class="amount-neg ozet-val">${fmt(kz.kasaCikis)} ₺</span></div>
    <div class="ozet-row"><span class="ozet-label">🛒 Toptancı Alış</span><span class="amount-neg ozet-val">${fmt(kz.maliyet)} ₺</span></div>
    <div class="ozet-row" style="background:var(--accent-light);border-radius:8px;padding:8px 4px">
      <span style="font-weight:700">📊 Brüt Kâr</span>
      <span class="ozet-val ${kz.brutKar>=0?'amount-pos':'amount-neg'}">${fmt(kz.brutKar)} ₺ <small style="font-size:10px">(${margin}%)</small></span>
    </div>
    <div class="ozet-row" style="margin-top:4px"><span class="ozet-label">📋 Giderler</span><span class="amount-neg ozet-val">${fmt(kz.gider)} ₺</span></div>
    <div class="ozet-row"><span class="ozet-label">👷 Çalışan + Vergi</span><span class="amount-neg ozet-val">${fmt(kz.ortakGider)} ₺</span></div>
    <div class="ozet-row" style="background:${kz.netKar>=0?'var(--green-light)':'var(--red-light)'};border-radius:8px;padding:8px 4px;margin-top:4px">
      <span style="font-weight:700">${kz.netKar>=0?'✅':'⚠️'} Net Kâr</span>
      <span class="ozet-val ${kz.netKar>=0?'amount-pos':'amount-neg'}">${fmt(kz.netKar)} ₺ <small style="font-size:10px">(${netMargin}%)</small></span>
    </div>`;

  // Kâr dağılımı
  document.getElementById('kzKarDagilim').innerHTML = `
    <div class="ozet-row"><span class="ozet-label">Her Ortağa (Brüt)</span><span class="amount-pos ozet-val">${fmt(kz.brutKar/2)} ₺</span></div>
    <div class="ozet-row"><span class="ozet-label">Her Ortağa (Net)</span><span class="ozet-val ${kz.netKar>=0?'amount-pos':'amount-neg'}">${fmt(kz.netKar/2)} ₺</span></div>
    <div class="ozet-row" style="margin-top:8px"><span class="ozet-label">Brüt Kâr Marjı</span><span class="ozet-val">${margin}%</span></div>
    <div class="ozet-row"><span class="ozet-label">Net Kâr Marjı</span><span class="ozet-val">${netMargin}%</span></div>
    <div class="ozet-row"><span class="ozet-label">Gider Oranı</span><span class="ozet-val">${kz.gelir>0?(((kz.gider+kz.ortakGider)/kz.gelir)*100).toFixed(1):0}%</span></div>
    <div class="ozet-row"><span class="ozet-label">Maliyet Oranı</span><span class="ozet-val">${kz.gelir>0?((kz.maliyet/kz.gelir)*100).toFixed(1):0}%</span></div>`;

  // Kırılım tablosu
  renderKZKirilim(bas, bit, birikimli);
}

function renderKZKirilim(bas, bit, birikimli) {
  const tbody = document.getElementById('kzKirilimBody');
  const th = document.getElementById('kzKirilimTh');
  const baslik = document.getElementById('kzKirilimBaslik');

  // Determine granularity
  const basDate = new Date(bas);
  const bitDate = new Date(bit);
  const diffDays = (bitDate - basDate) / (1000*60*60*24);

  let periods = [];

  if (kzDon === 'hafta' || diffDays <= 14) {
    // Günlük kırılım
    th.textContent = 'Gün';
    baslik.textContent = '📅 Günlük Kırılım';
    let cur = new Date(basDate);
    while (cur <= bitDate) {
      const d = cur.toISOString().split('T')[0];
      periods.push({ label: formatDate(d), bas: d, bit: d });
      cur.setDate(cur.getDate() + 1);
    }
  } else if (kzDon === 'ay' || diffDays <= 93) {
    // Haftalık kırılım
    th.textContent = 'Hafta';
    baslik.textContent = '📅 Haftalık Kırılım';
    let cur = new Date(basDate);
    while (cur <= bitDate) {
      const hBas = cur.toISOString().split('T')[0];
      const hBit = new Date(cur); hBit.setDate(cur.getDate() + 6);
      const hBitStr = hBit > bitDate ? bitDate.toISOString().split('T')[0] : hBit.toISOString().split('T')[0];
      periods.push({ label: `${formatDate(hBas)} – ${formatDate(hBitStr)}`, bas: hBas, bit: hBitStr });
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    // Aylık kırılım
    th.textContent = 'Ay';
    baslik.textContent = '📅 Aylık Kırılım';
    let cur = new Date(basDate.getFullYear(), basDate.getMonth(), 1);
    while (cur <= bitDate) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth()+1).padStart(2,'0');
      const lastDay = new Date(y, cur.getMonth()+1, 0).getDate();
      const pBas = `${y}-${m}-01`;
      const pBit = `${y}-${m}-${lastDay}`;
      const label = cur.toLocaleString('tr-TR', { month:'long', year:'numeric' });
      periods.push({ label, bas: pBas, bit: pBit });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  let cumGelir = 0, cumMaliyet = 0, cumGider = 0, cumBrut = 0, cumNet = 0;

  tbody.innerHTML = periods.map(p => {
    const kz = calcKZ(p.bas, p.bit);
    if (birikimli) {
      cumGelir += kz.gelir; cumMaliyet += kz.maliyet;
      cumGider += kz.gider + kz.ortakGider;
      cumBrut += kz.brutKar; cumNet += kz.netKar;
    }
    const g = birikimli ? cumGelir : kz.gelir;
    const m = birikimli ? cumMaliyet : kz.maliyet;
    const gid = birikimli ? cumGider : (kz.gider + kz.ortakGider);
    const brut = birikimli ? cumBrut : kz.brutKar;
    const net = birikimli ? cumNet : kz.netKar;
    if (!birikimli && g === 0 && m === 0 && gid === 0) return '';
    return `<tr>
      <td style="font-weight:600">${p.label}</td>
      <td class="amount-pos">${fmt(g)} ₺</td>
      <td class="amount-neg">${fmt(m)} ₺</td>
      <td class="${brut>=0?'amount-pos':'amount-neg'}">${fmt(brut)} ₺</td>
      <td class="amount-neg">${fmt(gid)} ₺</td>
      <td class="${net>=0?'amount-pos':'amount-neg'}" style="font-weight:700">${fmt(net)} ₺</td>
      <td class="${net>=0?'amount-pos':'amount-neg'}">${fmt(net/2)} ₺</td>
    </tr>`;
  }).filter(Boolean).join('') || `<tr><td colspan="7"><div class="empty"><div class="icon">📊</div><p>Bu dönemde veri yok</p></div></td></tr>`;

  // Toplam satırı
  const tot = calcKZ(bas, bit);
  tbody.innerHTML += `<tr style="background:var(--surface2);font-weight:800;border-top:2px solid var(--border)">
    <td>TOPLAM</td>
    <td class="amount-pos">${fmt(tot.gelir)} ₺</td>
    <td class="amount-neg">${fmt(tot.maliyet)} ₺</td>
    <td class="${tot.brutKar>=0?'amount-pos':'amount-neg'}">${fmt(tot.brutKar)} ₺</td>
    <td class="amount-neg">${fmt(tot.gider+tot.ortakGider)} ₺</td>
    <td class="${tot.netKar>=0?'amount-pos':'amount-neg'}" style="font-size:15px">${fmt(tot.netKar)} ₺</td>
    <td class="${tot.netKar>=0?'amount-pos':'amount-neg'}">${fmt(tot.netKar/2)} ₺</td>
  </tr>`;
}



// ===== PRINT PANEL =====
let printSections = { kasa:true, toptanci:true, gider:true, ortaklar:true, karzarar:true, ozet:true };
let printPeriod = 'tumü';

function openPrintPanel() {
  updatePrintPreview();
  openModal('printPanel');
}

function togglePrintSection(el, sec) {
  printSections[sec] = !printSections[sec];
  const box = document.getElementById('pci-' + sec);
  if (printSections[sec]) { box.classList.add('active'); el.classList.add('selected'); }
  else { box.classList.remove('active'); el.classList.remove('selected'); }
  updatePrintPreview();
}

function setPrintPeriod(don, btn) {
  printPeriod = don;
  document.querySelectorAll('.print-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const ozel = document.getElementById('printOzelAralik');
  ozel.style.display = don === 'ozel' ? 'flex' : 'none';
  updatePrintPreview();
}

function getPrintAralik() {
  const today = new Date();
  if (printPeriod === 'tumü') return { bas: '2000-01-01', bit: today.toISOString().split('T')[0], label: 'Tüm Kayıtlar' };
  if (printPeriod === 'yil') return { bas: `${today.getFullYear()}-01-01`, bit: `${today.getFullYear()}-12-31`, label: `${today.getFullYear()} Yılı` };
  if (printPeriod === 'ay') {
    const m = String(today.getMonth()+1).padStart(2,'0');
    const last = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
    return { bas:`${today.getFullYear()}-${m}-01`, bit:`${today.getFullYear()}-${m}-${last}`, label: today.toLocaleString('tr-TR',{month:'long',year:'numeric'}) };
  }
  if (printPeriod === 'hafta') {
    const day = today.getDay()||7;
    const bas = new Date(today); bas.setDate(today.getDate()-day+1);
    const bit = new Date(today); bit.setDate(today.getDate()+(7-day));
    return { bas:bas.toISOString().split('T')[0], bit:bit.toISOString().split('T')[0], label:'Bu Hafta' };
  }
  if (printPeriod === 'ozel') {
    const b = document.getElementById('printBas').value;
    const bi = document.getElementById('printBit').value;
    if (!b||!bi) return null;
    return { bas:b, bit:bi, label:`${formatDate(b)} – ${formatDate(bi)}` };
  }
  return null;
}

function updatePrintPreview() {
  const aralik = getPrintAralik();
  if (!aralik) { document.getElementById('printPeriodInfo').textContent='Tarih seçin'; return; }
  const { bas, bit, label } = aralik;
  document.getElementById('printPeriodInfo').textContent = `📅 ${label}  ·  ${formatDate(bas)} – ${formatDate(bit)}`;
  const inR = t => t >= bas && t <= bit;

  const secilen = Object.entries(printSections).filter(([k,v])=>v).map(([k])=>k);
  let html = '';

  if (printSections.kasa) {
    const rows = state.kasa.filter(k=>inR(k.tarih));
    const giris = rows.filter(k=>k.tur==='giris').reduce((s,k)=>s+k.tutar*k.kur,0);
    const cikis = rows.filter(k=>k.tur==='cikis').reduce((s,k)=>s+k.tutar*k.kur,0);
    html += `<div class="print-preview-row"><span>💰 Kasa</span><span>${rows.length} hareket · Giriş: <b style="color:var(--green)">${fmt(giris)} ₺</b> / Çıkış: <b style="color:var(--red)">${fmt(cikis)} ₺</b></span></div>`;
  }
  if (printSections.toptanci) {
    const rows = state.toptanciIslemler.filter(i=>inR(i.tarih));
    const alis = rows.filter(i=>i.tur==='alis').reduce((s,i)=>s+i.tutar,0);
    html += `<div class="print-preview-row"><span>🏭 Toptancı</span><span>${rows.length} hareket · Alış: <b style="color:var(--red)">${fmt(alis)} ₺</b></span></div>`;
  }
  if (printSections.gider) {
    const rows = state.giderler.filter(g=>inR(g.tarih));
    const top = rows.reduce((s,g)=>s+g.tutar,0);
    html += `<div class="print-preview-row"><span>📋 Giderler</span><span>${rows.length} kalem · <b style="color:var(--red)">${fmt(top)} ₺</b></span></div>`;
  }
  if (printSections.ortaklar) {
    const rows = state.ortakIslemler.filter(i=>inR(i.tarih));
    html += `<div class="print-preview-row"><span>🤝 Ortaklar</span><span>${rows.length} hareket</span></div>`;
  }
  if (printSections.karzarar) {
    const kz = calcKZ(bas, bit);
    html += `<div class="print-preview-row"><span>📈 Kâr/Zarar</span><span>Brüt: <b>${fmt(kz.brutKar)} ₺</b> · Net: <b style="color:${kz.netKar>=0?'var(--green)':'var(--red)'}">${fmt(kz.netKar)} ₺</b></span></div>`;
  }
  if (printSections.ozet) {
    html += `<div class="print-preview-row"><span>📊 Özet</span><span>Genel durum</span></div>`;
  }
  if (!html) html = '<div style="color:var(--text3);text-align:center;padding:12px">Hiçbir bölüm seçilmedi</div>';
  document.getElementById('printPreview').innerHTML = html;
}

function executePrint() {
  const aralik = getPrintAralik();
  if (!aralik) { showToast('Tarih aralığı seçin', 'error'); return; }
  const { bas, bit, label } = aralik;
  const secilen = Object.entries(printSections).filter(([k,v])=>v).map(([k])=>k);
  if (!secilen.length) { showToast('En az bir bölüm seçin', 'error'); return; }

  // Set print header
  const now = new Date();
  document.getElementById('phSubTitle').textContent = secilen.length === 6 ? 'Tam Rapor' : secilen.map(s=>({kasa:'Kasa',toptanci:'Toptancı',gider:'Giderler',ortaklar:'Ortaklar',karzarar:'Kâr/Zarar',ozet:'Özet'}[s])).join(' + ');
  document.getElementById('phPeriod').textContent = label + '  ·  ' + formatDate(bas) + ' – ' + formatDate(bit);
  document.getElementById('phDate').textContent = now.toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'}) + ' · ' + now.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('phUser').textContent = 'İşletme Kasa Takip Sistemi';

  // Filter data by date range for printing
  const inR = t => t >= bas && t <= bit;
  const origKasa = state.kasa;
  const origToptanci = state.toptanciIslemler;
  const origGider = state.giderler;
  const origOrtak = state.ortakIslemler;

  // Temporarily filter state for print
  state.kasa = state.kasa.filter(k=>inR(k.tarih));
  state.toptanciIslemler = state.toptanciIslemler.filter(i=>inR(i.tarih));
  state.giderler = state.giderler.filter(g=>inR(g.tarih));
  state.ortakIslemler = state.ortakIslemler.filter(i=>inR(i.tarih));

  // Re-render filtered data
  renderKasa(); renderToptanciIslemler(); renderGider(); renderOrtakIslemler();
  if (secilen.includes('ozet')) renderOzet();
  if (secilen.includes('karzarar')) { kzDon='ozel'; document.getElementById('kzBas').value=bas; document.getElementById('kzBit').value=bit; renderKarZarar(); }

  // Mark selected pages as print-active
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('print-active'); p.classList.remove('print-break'); });
  let first = true;
  secilen.forEach(sec => {
    const el = document.getElementById('page-' + sec);
    if (el) {
      el.classList.add('print-active');
      if (!first) el.classList.add('print-break');
      first = false;
    }
  });

  closeModal('printPanel');
  setTimeout(() => {
    window.print();
    // Restore original data
    setTimeout(() => {
      state.kasa = origKasa; state.toptanciIslemler = origToptanci;
      state.giderler = origGider; state.ortakIslemler = origOrtak;
      document.querySelectorAll('.page').forEach(p => { p.classList.remove('print-active'); p.classList.remove('print-break'); });
      renderKasa(); renderToptanciIslemler(); renderGider(); renderOrtakIslemler();
    }, 1500);
  }, 300);
}

// ===== BACKUP / RESTORE =====
function backupData() {
  const backup = { state, kurlar, date: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  const d = new Date().toLocaleDateString('tr-TR').replace(/\./g,'-');
  a.download = `kasa_yedek_${d}.json`; a.click(); URL.revokeObjectURL(a.href);
  showToast('Yedek indirildi ✓');
}

function restoreData(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.state) { showToast('Geçersiz dosya', 'error'); return; }
      if (!confirm('Mevcut veriler silinecek. Devam?')) return;
      state = parsed.state;
      if (parsed.kurlar) { kurlar = parsed.kurlar; saveKurlar(); }
      save(); init();
      showToast('Veriler geri yüklendi ✓');
    } catch(e) { showToast('Dosya okunamadı', 'error'); }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// ===== NAVIGATION =====
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-bottom-bar button').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  // Bottom bar'daki ilgili butonu da aktif yap
  const bottomBar = document.getElementById('navBottomBar');
  if (bottomBar) {
    bottomBar.querySelectorAll('button').forEach(b => {
      if (b.getAttribute('onclick') && b.getAttribute('onclick').includes("'" + name + "'")) {
        b.classList.add('active');
      }
    });
  }
  if (name === 'ozet') renderOzet();
  if (name === 'rapor') renderRapor();
  if (name === 'ortaklar') renderOrtakSayfasi();
  if (name === 'karzarar') renderKarZarar();
  if (name === 'gecmis-borc') renderGecmisBorc();
}

// ===== MODAL =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// ===== TOAST =====
let toastTimer;
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = (type==='success'?'✓ ':'✕ ') + msg;
  t.style.background = type==='error' ? 'var(--red)' : 'var(--text)';
  t.className = 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== UTILS =====
function fmt(n) { return (n||0).toLocaleString('tr-TR', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function formatDate(s) { if (!s) return '—'; const [y,m,d]=s.split('-'); return `${d}.${m}.${y}`; }

// ===== INIT =====
function init() {
  const today = todayStr();
  document.getElementById('kasaTarih').value = today;
  document.getElementById('giderTarih').value = today;
  document.getElementById('gbTarih').value = today;
  updateKasaKur();
  renderKurBar();
  renderKasa();
  renderStats();
  renderGecmisBorc();
  renderToptanciKartlar();
  renderToptanciIslemler();
  renderToptanciFilter();
  renderGider();
  renderGiderStats();
  giderOrtakDropdownDoldur();
  renderOrtakFilter();
  updateOrtakKur();
  document.getElementById('ortakTarih').value = todayStr();
  renderVadeHatirlatici();
  renderEskiBorcOzet();
}



// ── Global scope export ──
Object.assign(window, {
  kasaSelectUser,
  showPage, kasaEkle, kasaSil, fetchKurlar, openKurPanel, closeKurPanel, toggleKurPanel, saveManuelKur,
  gbEkle, gbOdendi, gbSil, renderGecmisBorc,
  openToptanciModal, toptanciEkle, toptanciSil,
  openIslemModal, islemEkle, islemSil, islemTurDegisti, odemeYontemiDegisti,
  openEskiBorcModal, eskiBorcEkle, eskiBorcSil, toggleEskiBorcDetay,
  renderToptanciIslemler,
  giderEkle, giderSil, giderOrtakDropdownDoldur,
  openPrintPanel, printRapor, setRaporDon, renderRapor,
  backupData, restoreData,
  ortakIslemEkle, ortakIslemSil, renderOrtakSayfasi,
  updateOrtakKur, renderOrtakFilter,
});

