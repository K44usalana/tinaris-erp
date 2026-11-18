/* TINARIS Batch E  Frontend halaman fitur baru + integrasi backend API.
   Pembelian Langsung, Retur Supplier, Koreksi Penerimaan, Produksi Cepat,
   Produksi Terbuka, Master Data CRUD, Ekspor/Impor Excel, Laporan Kadaluarsa. */
'use strict';

// ============================================================
// 0. Helper kolom Indonesia ke camelCase (sesuai kunciDari di backend)
// ============================================================
function headerToCamel(h){
  const w = String(h).split(' ');
  return w[0].toLowerCase() + w.slice(1).map(k=>k.charAt(0).toUpperCase()+k.slice(1)).join('');
}

// ============================================================
// 1. Tambah modul baru ke APP_MODULES
// ============================================================
APP_MODULES.push(
  ['directPurchase','Pembelian Langsung','cart'],
  ['returnSupplier','Retur Supplier','truck'],
  ['correctionReceipt','Koreksi Penerimaan','check'],
  ['quickProd','Produksi Cepat','chef'],
  ['openProd','Produksi Terbuka','chef'],
  ['exim','Ekspor / Impor','file'],
  ['masterCrud','Kelola Master','box'],
  ['expiry','Kadaluarsa','history']
);

// ============================================================
// 2. Akses modul berdasarkan peran
// ============================================================
const _beModuleAccess = moduleAccess;
moduleAccess = function(){
  const base = _beModuleAccess();
  if(['procurement','owner','warehouse'].includes(S.role)){
    base.push('directPurchase','returnSupplier');
  }
  if(['owner','warehouse','manager'].includes(S.role)) base.push('correctionReceipt');
  if(['owner','manager','ck'].includes(S.role)) base.push('quickProd','openProd');
  if(['owner','manager'].includes(S.role)) base.push('exim','masterCrud');
  base.push('expiry');
  return base;
};

// ============================================================
// 3. Override renderApp untuk modul baru
//    Chain: renderAppV3 > v5 > v6 > v8 > batchE
// ============================================================
const _beRenderers = {
  directPurchase(){return appDirectPurchase()},
  returnSupplier(){return appReturnSupplier()},
  correctionReceipt(){return appCorrectionReceipt()},
  quickProd(){return appQuickProd()},
  openProd(){return appOpenProd()},
  exim(){return appExim()},
  masterCrud(){return appMasterCrud()},
  expiry(){return appExpiry()}
};

const _beRenderOld = renderApp;
renderApp = function(){
  _beRenderOld.apply(this, arguments);
  const body = $('#app-body');
  if(!body) return;
  if(_beRenderers[S.module]) body.innerHTML = _beRenderers[S.module]();
  // Post-render hooks
  if(S.module === 'expiry' && apiToken) setTimeout(loadExpiryReport, 150);
  if(S.module === 'masterCrud' && apiToken && !window._mcRefreshing){
    window._mcRefreshing = true;
    loadMasterCache().then(()=>{
      const c=$('#crud-content');
      if(c) c.innerHTML = masterCrudContent();
      window._mcRefreshing = false;
    }).catch(()=>{ window._mcRefreshing = false; });
  }
};

// ============================================================
// 4. Helper: panggil backend API dari modal
// ============================================================
function apiModal(aksi, data, successMsg){
  const btn = $('.modal-footer .btn:last-child');
  if(btn){btn.disabled=true;btn.textContent='Memproses...';}
  api(aksi, data).then(()=>{
    closeModal(true);
    renderApp();
    toast(successMsg || 'Berhasil.');
  }).catch(e => {
    if(btn){btn.disabled=false;btn.textContent=btn.dataset.label||'Simpan';}
    showFormError(e);
  });
}

// ============================================================
// 5. Cache master data dari backend
// ============================================================
window._masterCache = {};
function loadMasterCache(){
  const jobs = ['produk','kategori','supplier','lokasi','kategoriSupplier','satuan','resepProduksi','bahanProduksi','pengguna'].map(jenis =>
    api('eksporData',{jenis}).then(resp => {
      if(!resp?.data) return;
      window._masterCache[jenis] = resp.data.map(row => {
        const o = {};
        (resp.kolom||Object.keys(row)).forEach(k => { o[headerToCamel(k)] = row[k]; });
        return o;
      });
    }).catch(()=>{})
  );
  return Promise.all(jobs);
}
// Muat cache saat ada token
if(apiToken) loadMasterCache();

// ============================================================
// 6. PEMBELIAN LANGSUNG
// ============================================================
function appDirectPurchase(){
  const canCreate = ['procurement','owner'].includes(S.role);
  const canVerify = ['owner','warehouse','manager'].includes(S.role);
  return titleApp('Pembelian Langsung',
    'Pembelian langsung tanpa PR/PO. Stok masuk saat dibuat, verifikasi oleh pihak lain.',
    canCreate?'<button class="btn" onclick="directPurchaseForm()">+ Pembelian Baru</button>':'')+
    '<div class="notice info mb">Barang langsung masuk stok Gudang. Pembuat tidak bisa verifikasi sendiri (kecuali Owner).</div>'+
    directPurchaseList(canVerify);
}

function directPurchaseList(canVerify){
  // Tampilkan dokumen dari backend via API dokumen
  return '<div id="dp-docs"><p class="small muted">Lihat riwayat di halaman Aktivitas atau gunakan Ekspor untuk mengunduh data.</p></div>';
}

function directPurchaseForm(){
  const supCache = window._masterCache?.supplier || [];
  modal('Pembelian Langsung',
    formContext()+
    '<div class="form-grid">'+
    '<label class="field">Supplier<select id="dp-supplier">'+
      '<option value="">Pilih supplier...</option>'+
      supCache.filter(s=>s.status==='Aktif').map(s=>'<option value="'+E(s.kodeSupplier)+'">'+E(s.namaSupplier)+'</option>').join('')+
    '</select></label>'+
    '<label class="field">No. nota supplier<input id="dp-nota" placeholder="Nomor nota/faktur"></label>'+
    '<label class="field full">Catatan<textarea id="dp-catatan" rows="2" placeholder="Alasan pembelian langsung"></textarea></label>'+
    '</div>'+
    '<h4 class="mt">Barang yang dibeli</h4>'+
    '<div id="dp-lines">'+inputLine({},'purchase')+'</div>'+
    '<button class="btn secondary sm mt" onclick="$(\'#dp-lines\').insertAdjacentHTML(\'beforeend\',inputLine({},\'purchase\'));focusNewRow(\'#dp-lines\')">+ Tambah barang</button>'+
    '<div id="row-undo"></div>'+
    '<div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button>'+
    '<button class="btn" data-label="Buat Pembelian" onclick="submitDirectPurchase()">Buat Pembelian</button>'
  );
}

function submitDirectPurchase(){
  action(()=>{
    const supplier = $('#dp-supplier').value;
    const nota = $('#dp-nota').value.trim();
    const catatan = $('#dp-catatan').value.trim();
    if(!supplier) throw Error('Supplier wajib dipilih.');
    if(!nota) throw Error('Nomor nota wajib diisi.');
    if(!catatan) throw Error('Catatan/alasan wajib diisi.');
    const items = readInputLines('#dp-lines', true);
    if(!items.length) throw Error('Minimal satu barang.');
    apiModal('buatPembelianLangsung', {
      kodeSupplier: supplier,
      nomorNota: nota,
      catatan: catatan,
      kodeLokasi: 'BNY-GDG',
      item: items.map(i => ({
        kodeProduk: i.pid,
        jumlah: i.inputQty,
        hargaSatuan: i.price || 0
      }))
    }, 'Pembelian langsung berhasil dibuat. Menunggu verifikasi.');
  });
}

// ============================================================
// 7. RETUR SUPPLIER
// ============================================================
function appReturnSupplier(){
  return titleApp('Retur Supplier',
    'Kembalikan barang ke supplier berdasarkan penerimaan.',
    ['procurement','owner','warehouse'].includes(S.role)?'<button class="btn" onclick="returSupplierForm()">+ Retur Baru</button>':'')+
    '<div class="notice info mb">Retur mengurangi stok gudang. Memerlukan nomor penerimaan (GR) sebagai referensi. Perlu persetujuan manager/owner.</div>'+
    '<p class="small muted">Riwayat retur dapat dilihat dari halaman Aktivitas atau Ekspor data.</p>';
}

function returSupplierForm(){
  modal('Retur Supplier',
    formContext()+
    '<div class="form-grid">'+
    '<label class="field">No. Penerimaan (referensi)<input id="rt-ref" placeholder="Contoh: GR2611xxxx"></label>'+
    '<label class="field full">Alasan retur<textarea id="rt-alasan" rows="2" placeholder="Barang rusak, tidak sesuai pesanan, dll"></textarea></label>'+
    '</div>'+
    '<h4 class="mt">Barang yang diretur</h4>'+
    '<div id="rt-lines">'+inputLine()+'</div>'+
    '<button class="btn secondary sm mt" onclick="$(\'#rt-lines\').insertAdjacentHTML(\'beforeend\',inputLine());focusNewRow(\'#rt-lines\')">+ Tambah barang</button>'+
    '<div id="row-undo"></div>'+
    '<div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button>'+
    '<button class="btn" data-label="Ajukan Retur" onclick="submitReturSupplier()">Ajukan Retur</button>'
  );
}

function submitReturSupplier(){
  action(()=>{
    const ref = $('#rt-ref').value.trim();
    const alasan = $('#rt-alasan').value.trim();
    if(!ref) throw Error('Nomor penerimaan referensi wajib diisi.');
    if(!alasan) throw Error('Alasan retur wajib diisi.');
    const items = readInputLines('#rt-lines');
    if(!items.length) throw Error('Minimal satu barang.');
    apiModal('buatReturSupplier', {
      noPenerimaan: ref,
      alasan: alasan,
      kodeLokasi: 'BNY-GDG',
      item: items.map(i => ({kodeProduk: i.pid, jumlah: i.inputQty}))
    }, 'Retur supplier diajukan. Menunggu persetujuan.');
  });
}

// ============================================================
// 8. KOREKSI PENERIMAAN
// ============================================================
function appCorrectionReceipt(){
  return titleApp('Koreksi Penerimaan',
    'Koreksi jumlah barang yang sudah diterima. Positif = tambah stok, negatif = kurangi.',
    ['owner','warehouse','manager'].includes(S.role)?'<button class="btn" onclick="koreksiForm()">+ Koreksi Baru</button>':'')+
    '<div class="notice info mb">Koreksi memerlukan nomor penerimaan sebagai referensi. Perubahan stok terjadi setelah disetujui.</div>'+
    '<p class="small muted">Riwayat koreksi dapat dilihat dari halaman Aktivitas atau Ekspor data.</p>';
}

function koreksiForm(){
  modal('Koreksi Penerimaan',
    formContext()+
    '<div class="form-grid">'+
    '<label class="field">No. Penerimaan<input id="kr-ref" placeholder="Contoh: GR2611xxxx"></label>'+
    '<label class="field full">Alasan koreksi<textarea id="kr-alasan" rows="2" placeholder="Selisih jumlah, kerusakan ditemukan kemudian, dll"></textarea></label>'+
    '</div>'+
    '<h4 class="mt">Barang yang dikoreksi</h4>'+
    '<p class="small muted">Jumlah positif = tambah stok, jumlah negatif = kurangi stok.</p>'+
    '<div id="kr-lines">'+koreksiLine()+'</div>'+
    '<button class="btn secondary sm mt" onclick="addKoreksiLine()">+ Tambah barang</button>'+
    '<div id="row-undo"></div>'+
    '<div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button>'+
    '<button class="btn" data-label="Ajukan Koreksi" onclick="submitKoreksi()">Ajukan Koreksi</button>'
  );
}

function koreksiLine(){
  const uid = ++rowSequence;
  return '<div class="multi-row input-line" data-kind="general" data-rowid="'+uid+'">'+
    '<div class="field item-field"><label>Barang</label><input class="row-search" type="search" placeholder="Cari barang" oninput="filterProductRow(this)"><select class="row-pid" onchange="rowProductChanged(this)">'+itemOptions()+'</select></div>'+
    '<label class="field">Satuan<select class="row-unit" disabled><option value="">Pilih barang dahulu</option></select></label>'+
    '<label class="field">Jumlah koreksi<input class="row-qty" type="number" step="any" placeholder="+/- jumlah"></label>'+
    '<button class="close" onclick="removeMultiRow(this)">x</button></div>';
}

function addKoreksiLine(){
  $('#kr-lines').insertAdjacentHTML('beforeend', koreksiLine());
  focusNewRow('#kr-lines');
}

function submitKoreksi(){
  action(()=>{
    const ref = $('#kr-ref').value.trim();
    const alasan = $('#kr-alasan').value.trim();
    if(!ref) throw Error('Nomor penerimaan wajib diisi.');
    if(!alasan) throw Error('Alasan koreksi wajib diisi.');
    const rows = $$('#kr-lines .multi-row');
    const item = rows.map((row,j) => {
      const pid = $('.row-pid',row).value;
      const qty = Number($('.row-qty',row).value);
      if(!pid) throw Error('Baris '+(j+1)+': pilih barang.');
      if(!Number.isFinite(qty) || qty === 0) throw Error('Baris '+(j+1)+': jumlah koreksi tidak boleh nol.');
      return {kodeProduk: pid, jumlah: qty};
    });
    if(!item.length) throw Error('Minimal satu barang.');
    apiModal('buatKoreksiPenerimaan', {
      noPenerimaan: ref,
      alasan: alasan,
      kodeLokasi: 'BNY-GDG',
      item
    }, 'Koreksi penerimaan diajukan. Menunggu persetujuan.');
  });
}

// ============================================================
// 9. PRODUKSI CEPAT
// ============================================================
function appQuickProd(){
  return titleApp('Produksi Cepat',
    'Produksi satu langkah dari resep. Bahan keluar dan hasil masuk langsung.',
    ['owner','manager','ck'].includes(S.role)?'<button class="btn" onclick="quickProdForm()">+ Produksi Cepat</button>':'')+
    '<div class="notice info mb">Gunakan resep yang sudah terdaftar. Bahan dikurangi dan hasil ditambahkan ke stok CK dalam satu langkah tanpa persetujuan.</div>'+
    '<p class="small muted">Riwayat produksi cepat dapat dilihat dari halaman Aktivitas atau Ekspor data.</p>';
}

function quickProdForm(){
  const resep = window._masterCache?.resepProduksi || [];
  modal('Produksi Cepat',
    formContext()+
    '<div class="form-grid">'+
    '<label class="field">Resep<select id="qp-resep" onchange="quickProdPreview()">'+
      '<option value="">Pilih resep...</option>'+
      resep.map(r=>'<option value="'+E(r.kodeResep)+'">'+E(r.namaResep||r.kodeResep)+' ('+E(r.kodeProdukHasil)+')</option>').join('')+
    '</select></label>'+
    '<label class="field">Jumlah batch<input id="qp-batch" type="number" min="1" step="1" value="1" onchange="quickProdPreview()"></label>'+
    '</div>'+
    '<div id="qp-preview" class="mt"><p class="small muted">Pilih resep untuk melihat kebutuhan bahan.</p></div>'+
    '<div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button>'+
    '<button class="btn" data-label="Produksi" onclick="submitQuickProd()">Jalankan Produksi</button>'
  );
}

function quickProdPreview(){
  const kode = $('#qp-resep')?.value;
  const preview = $('#qp-preview');
  if(!preview) return;
  if(!kode){preview.innerHTML='<p class="small muted">Pilih resep untuk melihat kebutuhan bahan.</p>';return;}
  const bahan = (window._masterCache?.bahanProduksi||[]).filter(b=>b.kodeResep===kode);
  if(!bahan.length){preview.innerHTML='<p class="small muted">Tidak ada bahan terdaftar untuk resep ini.</p>';return;}
  const batch = Math.max(1, Number($('#qp-batch')?.value)||1);
  preview.innerHTML = '<table class="data-table"><thead><tr><th>Bahan</th><th>Kebutuhan (x'+batch+')</th><th>Satuan</th><th>Susut %</th></tr></thead><tbody>'+
    bahan.map(b=>{
      const jml = Number(b.jumlah||0)*batch;
      const susut = Number(b.persenSusut||0);
      const efektif = susut > 0 ? jml * (1 + susut/100) : jml;
      return '<tr><td>'+E(b.namaProduk||b.kodeProduk)+'</td><td>'+fmt(efektif)+(susut>0?' <small class="muted">('+fmt(jml)+' + susut)</small>':'')+'</td><td>'+E(b.satuan||'')+'</td><td>'+(susut>0?susut+'%':'-')+'</td></tr>';
    }).join('')+
    '</tbody></table>';
}

function submitQuickProd(){
  action(()=>{
    const kode = $('#qp-resep').value;
    const batch = Number($('#qp-batch').value);
    if(!kode) throw Error('Resep wajib dipilih.');
    if(!batch || batch < 1) throw Error('Jumlah batch minimal 1.');
    apiModal('buatProduksiCepat', {
      kodeResep: kode,
      batch: batch,
      kodeLokasi: 'BNY-CK'
    }, 'Produksi cepat berhasil. Stok bahan berkurang, hasil bertambah.');
  });
}

// ============================================================
// 10. PRODUKSI TERBUKA
// ============================================================
function appOpenProd(){
  return titleApp('Produksi Terbuka',
    'Produksi tanpa resep. Tentukan bahan dan hasil sendiri.',
    ['owner','manager','ck'].includes(S.role)?'<button class="btn" onclick="openProdForm()">+ Produksi Terbuka</button>':'')+
    '<div class="notice info mb">Alur: Diajukan > Disetujui > Eksekusi (stok berubah). Pembuat tidak bisa menyetujui sendiri (kecuali Owner).</div>'+
    '<p class="small muted">Riwayat produksi terbuka dapat dilihat dari halaman Aktivitas atau Ekspor data.</p>';
}

function openProdForm(){
  modal('Produksi Terbuka',
    formContext()+
    '<label class="field full">Catatan produksi<textarea id="op-catatan" rows="2" placeholder="Deskripsi produksi yang akan dilakukan"></textarea></label>'+
    '<h4 class="mt">Hasil produksi</h4>'+
    '<div id="op-hasil">'+openProdHasilLine()+'</div>'+
    '<button class="btn secondary sm mt" onclick="$(\'#op-hasil\').insertAdjacentHTML(\'beforeend\',openProdHasilLine())">+ Tambah hasil</button>'+
    '<h4 class="mt">Bahan yang digunakan</h4>'+
    '<div id="op-bahan">'+inputLine({},'material')+'</div>'+
    '<button class="btn secondary sm mt" onclick="$(\'#op-bahan\').insertAdjacentHTML(\'beforeend\',inputLine({},\'material\'));focusNewRow(\'#op-bahan\')">+ Tambah bahan</button>'+
    '<div id="row-undo"></div>'+
    '<div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button>'+
    '<button class="btn" data-label="Ajukan" onclick="submitOpenProd()">Ajukan Produksi</button>'
  );
}

function openProdHasilLine(){
  const uid = ++rowSequence;
  return '<div class="multi-row input-line" data-kind="general" data-rowid="'+uid+'">'+
    '<div class="field item-field"><label>Produk hasil</label><input class="row-search" type="search" placeholder="Cari produk hasil" oninput="filterProductRow(this)"><select class="row-pid" onchange="rowProductChanged(this)">'+itemOptions()+'</select></div>'+
    '<label class="field">Satuan<select class="row-unit" disabled><option value="">Pilih barang dahulu</option></select></label>'+
    '<label class="field">Jumlah<input class="row-qty" type="number" min="0.001" step="any" placeholder="Jumlah hasil"></label>'+
    '<button class="close" onclick="removeMultiRow(this)">x</button></div>';
}

function submitOpenProd(){
  action(()=>{
    const catatan = $('#op-catatan').value.trim();
    if(!catatan) throw Error('Catatan produksi wajib diisi.');
    // Baca hasil
    const hasilRows = $$('#op-hasil .multi-row');
    const hasil = hasilRows.map((row,j) => {
      const pid = $('.row-pid',row).value;
      const qty = Number($('.row-qty',row).value);
      if(!pid) throw Error('Hasil baris '+(j+1)+': pilih produk.');
      if(!qty || qty <= 0) throw Error('Hasil baris '+(j+1)+': jumlah harus positif.');
      return {kodeProduk: pid, jumlah: qty};
    });
    if(!hasil.length) throw Error('Minimal satu produk hasil.');
    // Baca bahan
    const bahan = readInputLines('#op-bahan').map(i => ({kodeProduk: i.pid, jumlah: i.inputQty}));
    if(!bahan.length) throw Error('Minimal satu bahan.');
    apiModal('buatProduksiTerbuka', {
      catatan,
      kodeLokasi: 'BNY-CK',
      hasil,
      bahan
    }, 'Produksi terbuka diajukan. Menunggu persetujuan.');
  });
}

// ============================================================
// 11. EKSPOR / IMPOR EXCEL
// ============================================================
function appExim(){
  return titleApp('Ekspor / Impor Data',
    'Unduh data master/stok ke Excel atau impor data master dari Excel.','')+
    '<div class="grid2">'+
    '<div class="card"><h3>Ekspor ke Excel</h3><p class="small muted">Pilih jenis data untuk diunduh.</p>'+
    '<select id="exim-jenis" class="mt">'+
      '<option value="produk">Produk</option><option value="kategori">Kategori</option>'+
      '<option value="supplier">Supplier</option><option value="lokasi">Lokasi</option>'+
      '<option value="kategoriSupplier">Kategori Supplier</option><option value="satuan">Satuan Produk</option>'+
      '<option value="resepProduksi">Resep Produksi</option><option value="bahanProduksi">Bahan Produksi</option>'+
      '<option value="stok">Stok</option><option value="kartuStok">Kartu Stok</option><option value="lapisanStok">Lapisan Stok</option>'+
    '</select>'+
    '<p class="small muted mt">Lokasi (untuk data stok): '+E(locName(S.location))+'</p>'+
    '<button class="btn mt" onclick="eksporExcel()">Unduh Excel</button></div>'+
    '<div class="card"><h3>Impor dari Excel</h3><p class="small muted">Upload file Excel (.xlsx) untuk mengimpor data master. Header kolom harus sesuai template ekspor.</p>'+
    '<select id="impor-jenis" class="mt"><option value="produk">Produk</option><option value="supplier">Supplier</option><option value="satuan">Satuan Produk</option></select>'+
    '<input type="file" id="impor-file" accept=".xlsx,.xls,.csv" class="mt">'+
    '<button class="btn mt" onclick="imporExcel()">Impor</button>'+
    '<div id="impor-result" class="mt"></div></div>'+
    '</div>';
}

function eksporExcel(){
  const jenis = $('#exim-jenis').value;
  const data = {jenis};
  if(['stok','kartuStok','lapisanStok'].includes(jenis)) data.kodeLokasi = S.location;
  toast('Mengunduh data '+jenis+'...');
  api('eksporData', data).then(resp => {
    if(!resp?.data?.length){toast('Tidak ada data untuk diekspor.',true);return;}
    if(typeof XLSX !== 'undefined'){
      const ws = XLSX.utils.json_to_sheet(resp.data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, jenis);
      XLSX.writeFile(wb, 'tinaris_'+jenis+'_'+today().replace(/-/g,'')+'.xlsx');
      toast('File Excel berhasil diunduh.');
    } else {
      // Fallback CSV
      const headers = resp.kolom;
      const csv = [headers.join(','), ...resp.data.map(row =>
        headers.map(h => '"'+String(row[h]??'').replace(/"/g,'""')+'"').join(',')
      )].join('\n');
      const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'tinaris_'+jenis+'_'+today().replace(/-/g,'')+'.csv';
      a.click(); URL.revokeObjectURL(url);
      toast('File CSV berhasil diunduh (SheetJS belum dimuat untuk format .xlsx).');
    }
  }).catch(e => toast('Gagal ekspor: '+(e.message||e), true));
}

function imporExcel(){
  const jenis = $('#impor-jenis').value;
  const file = $('#impor-file')?.files?.[0];
  if(!file){toast('Pilih file terlebih dahulu.',true);return;}
  const reader = new FileReader();
  reader.onload = function(ev){
    try {
      let items;
      if(typeof XLSX !== 'undefined'){
        const wb = XLSX.read(ev.target.result, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        items = XLSX.utils.sheet_to_json(ws);
      } else {
        // Fallback: parse CSV sederhana
        const text = new TextDecoder().decode(new Uint8Array(ev.target.result));
        const lines = text.split('\n').filter(l=>l.trim());
        if(lines.length < 2){toast('File kosong.',true);return;}
        const headers = lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,''));
        items = lines.slice(1).map(line => {
          const vals = line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
          const o = {};
          headers.forEach((h,i) => o[h] = vals[i]||'');
          return o;
        });
      }
      if(!items?.length){toast('File tidak berisi data.',true);return;}
      const aksiMap = {produk:'imporProduk', supplier:'imporSupplier', satuan:'imporSatuan'};
      toast('Mengimpor '+items.length+' baris...');
      api(aksiMap[jenis], {items}).then(resp => {
        let msg = 'Impor selesai.';
        if(resp.baru !== undefined) msg += ' Baru: '+resp.baru+'.';
        if(resp.diperbarui !== undefined) msg += ' Diperbarui: '+resp.diperbarui+'.';
        if(resp.galat?.length) msg += ' Galat: '+resp.galat.length+'.';
        toast(msg);
        const result = $('#impor-result');
        if(result){
          result.innerHTML = '<div class="notice '+(resp.galat?.length?'error':'info')+' mt"><p>'+E(msg)+'</p>'+
            (resp.galat?.length?'<details class="mt"><summary>Detail galat</summary><ul>'+resp.galat.map(g=>'<li>'+E(g)+'</li>').join('')+'</ul></details>':'')+
            '</div>';
        }
        loadMasterCache();
      }).catch(e => toast('Gagal impor: '+(e.message||e), true));
    } catch(err){
      toast('Gagal membaca file: '+err.message, true);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ============================================================
// 12. KELOLA MASTER DATA (CRUD)
// ============================================================
let masterCrudTab = 'produk';

function appMasterCrud(){
  const tabs = [
    ['produk','Produk'],['kategori','Kategori'],['supplier','Supplier'],
    ['kategoriSupplier','Kat. Supplier'],['lokasi','Lokasi'],['satuan','Satuan'],
    ['resep','Resep Produksi'],['pengguna','Pengguna']
  ];
  return titleApp('Kelola Master Data','Tambah dan ubah data master melalui backend.','')+
    '<div class="segmented mb">'+tabs.map(([k,v])=>
      '<button class="'+(masterCrudTab===k?'active':'')+'" onclick="masterCrudTab=\''+k+'\';renderApp()">'+E(v)+'</button>'
    ).join('')+'</div>'+
    '<div id="crud-content">'+masterCrudContent()+'</div>';
}

function masterCrudContent(){
  const m = masterCrudTab;
  const addBtn = '<button class="btn sm mb" onclick="crudAddForm(\''+m+'\')">+ Tambah '+E(m)+'</button>';

  if(m === 'produk'){
    const data = window._masterCache?.produk || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data atau sedang memuat dari backend...</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Kode</th><th>Nama</th><th>Kategori</th><th>Satuan</th><th>Status</th><th></th></tr></thead><tbody>'+
      data.slice(0,100).map(r=>'<tr><td>'+E(r.kodeProduk)+'</td><td>'+E(r.namaProduk)+'</td><td>'+E(r.kategori||'')+'</td><td>'+E(r.satuanDasar||'')+'</td><td>'+statusBadge(r.status)+'</td><td><button class="btn ghost sm" onclick="crudEditProduk(\''+E(r.kodeProduk)+'\')">Edit</button></td></tr>').join('')+
      '</tbody></table></div>'+(data.length>100?'<p class="small muted mt">Menampilkan 100 dari '+data.length+' produk.</p>':'');
  }
  if(m === 'kategori'){
    const data = window._masterCache?.kategori || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data.</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Nama</th><th>Status</th><th></th></tr></thead><tbody>'+
      data.map(r=>'<tr><td>'+E(r.namaKategori)+'</td><td>'+statusBadge(r.status||'Aktif')+'</td><td><button class="btn ghost sm" onclick="crudEditKategori(\''+E(r.namaKategori)+'\')">Edit</button></td></tr>').join('')+
      '</tbody></table></div>';
  }
  if(m === 'supplier'){
    const data = window._masterCache?.supplier || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data.</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Kode</th><th>Nama</th><th>Telepon</th><th>Kategori</th><th></th></tr></thead><tbody>'+
      data.map(r=>'<tr><td>'+E(r.kodeSupplier)+'</td><td>'+E(r.namaSupplier)+'</td><td>'+E(r.telepon||'')+'</td><td>'+E(r.kategoriSupplier||'')+'</td><td><button class="btn ghost sm" onclick="crudEditSupplier(\''+E(r.kodeSupplier)+'\')">Edit</button></td></tr>').join('')+
      '</tbody></table></div>';
  }
  if(m === 'kategoriSupplier'){
    const data = window._masterCache?.kategoriSupplier || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data.</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Nama</th><th>Status</th></tr></thead><tbody>'+
      data.map(r=>'<tr><td>'+E(r.nama||r.namaKategoriSupplier||'')+'</td><td>'+statusBadge(r.status||'Aktif')+'</td></tr>').join('')+
      '</tbody></table></div>';
  }
  if(m === 'lokasi'){
    const data = window._masterCache?.lokasi || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data.</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Kode</th><th>Nama</th><th>Outlet</th><th>Status</th></tr></thead><tbody>'+
      data.map(r=>'<tr><td>'+E(r.kodeLokasi)+'</td><td>'+E(r.namaLokasi||'')+'</td><td>'+E(r.kodeOutlet||'')+'</td><td>'+statusBadge(r.status||'Aktif')+'</td></tr>').join('')+
      '</tbody></table></div>';
  }
  if(m === 'pengguna'){
    const data = window._masterCache?.pengguna || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data.</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Nama</th><th>Peran</th><th>Outlet</th><th>Status</th></tr></thead><tbody>'+
      data.map(r=>'<tr><td>'+E(r.idPengguna||r.id||'')+'</td><td>'+E(r.nama||'')+'</td><td>'+E(r.peran||'')+'</td><td>'+E(r.outlet||'')+'</td><td>'+statusBadge(r.status||'Aktif')+'</td></tr>').join('')+
      '</tbody></table></div>';
  }
  // satuan, resep: tampilan sederhana
  if(m === 'satuan'){
    const data = window._masterCache?.satuan || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data.</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Produk</th><th>Satuan</th><th>Faktor ke Dasar</th><th>Satuan Dasar</th></tr></thead><tbody>'+
      data.slice(0,100).map(r=>'<tr><td>'+E(r.kodeProduk)+' '+E(r.namaProduk||'')+'</td><td>'+E(r.satuan)+'</td><td>'+fmt(r.faktorKeDasar)+'</td><td>'+E(r.satuanDasar||'')+'</td></tr>').join('')+
      '</tbody></table></div>';
  }
  if(m === 'resep'){
    const data = window._masterCache?.resepProduksi || [];
    if(!data.length) return addBtn+'<p class="small muted">Belum ada data.</p>';
    return addBtn+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Kode</th><th>Nama</th><th>Produk Hasil</th><th>Jumlah</th><th>Satuan</th></tr></thead><tbody>'+
      data.map(r=>'<tr><td>'+E(r.kodeResep)+'</td><td>'+E(r.namaResep||'')+'</td><td>'+E(r.kodeProdukHasil||'')+'</td><td>'+fmt(r.jumlahHasil)+'</td><td>'+E(r.satuanHasil||'')+'</td></tr>').join('')+
      '</tbody></table></div>';
  }
  return addBtn+'<p class="small muted">Gunakan tombol Tambah di atas.</p>';
}

// ---- CRUD Forms ----
function crudAddForm(jenis){
  if(jenis === 'produk'){
    const katCache = window._masterCache?.kategori || [];
    modal('Tambah Produk',
      '<div class="form-grid">'+
      '<label class="field">Kode Produk<input id="c-kode" placeholder="Contoh: BRG-001"></label>'+
      '<label class="field">Nama Produk<input id="c-nama"></label>'+
      '<label class="field">Kategori<select id="c-kat"><option value="">Pilih...</option>'+katCache.filter(k=>k.status==='Aktif').map(k=>'<option>'+E(k.namaKategori)+'</option>').join('')+'</select></label>'+
      '<label class="field">Sub Kategori<input id="c-sub" placeholder="Opsional"></label>'+
      '<label class="field">Satuan Dasar<input id="c-satuan" placeholder="Contoh: gr, pcs, liter"></label>'+
      '</div><div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button>'+
      '<button class="btn" onclick="crudSubmitProduk()">Simpan</button>');
  } else if(jenis === 'kategori'){
    modal('Tambah Kategori',
      '<label class="field">Nama Kategori<input id="c-nama"></label><div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudSubmitKategori()">Simpan</button>');
  } else if(jenis === 'supplier'){
    modal('Tambah Supplier',
      '<div class="form-grid">'+
      '<label class="field">Kode Supplier<input id="c-kode"></label>'+
      '<label class="field">Nama Supplier<input id="c-nama"></label>'+
      '<label class="field">Telepon<input id="c-telp"></label>'+
      '<label class="field">Rekening<input id="c-rek"></label>'+
      '</div><div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudSubmitSupplier()">Simpan</button>');
  } else if(jenis === 'kategoriSupplier'){
    modal('Tambah Kategori Supplier',
      '<label class="field">Nama<input id="c-nama"></label><div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudSubmitKatSupplier()">Simpan</button>');
  } else if(jenis === 'satuan'){
    modal('Tambah Satuan Produk',
      '<div class="form-grid">'+
      '<label class="field">Kode Produk<input id="c-kode" placeholder="Kode produk yang sudah ada"></label>'+
      '<label class="field">Satuan<input id="c-satuan" placeholder="Contoh: kg, dus"></label>'+
      '<label class="field">Faktor ke dasar<input id="c-faktor" type="number" min="0.001" step="any" placeholder="1 kg = 1000 gr, isi 1000"></label>'+
      '</div><div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudSubmitSatuan()">Simpan</button>');
  } else if(jenis === 'pengguna'){
    modal('Tambah Pengguna',
      '<div class="form-grid">'+
      '<label class="field">ID Pengguna<input id="c-id" placeholder="Contoh: BNY-FLK-02"></label>'+
      '<label class="field">Nama<input id="c-nama"></label>'+
      '<label class="field">Peran<select id="c-peran">'+Object.entries(ROLES).map(([k,v])=>'<option value="'+k+'">'+E(v)+'</option>').join('')+'</select></label>'+
      '<label class="field">Outlet<input id="c-outlet" placeholder="BNY atau BNY,MGS"></label>'+
      '<label class="field">Kode Lokasi<input id="c-lokasi" placeholder="BNY-FLK"></label>'+
      '</div><div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudSubmitPengguna()">Simpan</button>');
  } else if(jenis === 'resep'){
    modal('Tambah Resep Produksi',
      '<div class="form-grid">'+
      '<label class="field">Kode Resep<input id="c-kode" placeholder="Contoh: RSP-001"></label>'+
      '<label class="field">Nama Resep<input id="c-nama"></label>'+
      '<label class="field">Kode Produk Hasil<input id="c-hasil" placeholder="Kode produk"></label>'+
      '<label class="field">Jumlah Hasil<input id="c-jumlahHasil" type="number" min="0.001" step="any"></label>'+
      '<label class="field">Satuan Hasil<input id="c-satuanHasil"></label>'+
      '</div>'+
      '<h4 class="mt">Bahan</h4>'+
      '<div id="c-bahan">'+crudBahanLine()+'</div>'+
      '<button class="btn secondary sm mt" onclick="$(\'#c-bahan\').insertAdjacentHTML(\'beforeend\',crudBahanLine())">+ Tambah bahan</button>'+
      '<div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudSubmitResep()">Simpan</button>');
  } else if(jenis === 'lokasi'){
    modal('Tambah Lokasi',
      '<div class="form-grid">'+
      '<label class="field">Kode Lokasi<input id="c-kode" placeholder="Contoh: BNY-BAR"></label>'+
      '<label class="field">Nama Lokasi<input id="c-nama"></label>'+
      '<label class="field">Kode Outlet<input id="c-outlet" placeholder="BNY"></label>'+
      '</div><div id="form-error" class="notice error mt" hidden></div>',
      '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudSubmitLokasi()">Simpan</button>');
  }
}

function crudBahanLine(){
  return '<div class="form-grid crud-bahan-row mt">'+
    '<label class="field">Kode Produk Bahan<input class="cb-kode" placeholder="Kode bahan"></label>'+
    '<label class="field">Jumlah<input class="cb-jumlah" type="number" min="0.001" step="any"></label>'+
    '<label class="field">Satuan<input class="cb-satuan" placeholder="Satuan bahan"></label>'+
    '<label class="field">Susut %<input class="cb-susut" type="number" min="0" step="any" value="0"></label>'+
    '</div>';
}

// ---- CRUD Submit ----
function crudSubmitProduk(){
  action(()=>{
    const kode=$('#c-kode').value.trim(), nama=$('#c-nama').value.trim(), kat=$('#c-kat').value, sub=$('#c-sub').value.trim(), satuan=$('#c-satuan').value.trim();
    if(!kode) throw Error('Kode produk wajib diisi.');
    if(!nama) throw Error('Nama produk wajib diisi.');
    if(!satuan) throw Error('Satuan dasar wajib diisi.');
    apiModal('tambahProduk', {kodeProduk:kode, namaProduk:nama, kategori:kat, subKategori:sub, satuanDasar:satuan}, 'Produk berhasil ditambahkan.');
  });
}

function crudEditProduk(kode){
  const p = (window._masterCache?.produk||[]).find(r=>r.kodeProduk===kode);
  if(!p){toast('Produk tidak ditemukan.',true);return;}
  const katCache = window._masterCache?.kategori || [];
  modal('Edit Produk: '+kode,
    '<div class="form-grid">'+
    '<label class="field">Nama Produk<input id="c-nama" value="'+E(p.namaProduk)+'"></label>'+
    '<label class="field">Kategori<select id="c-kat">'+katCache.filter(k=>k.status==='Aktif').map(k=>'<option '+(k.namaKategori===p.kategori?'selected':'')+'>'+E(k.namaKategori)+'</option>').join('')+'</select></label>'+
    '<label class="field">Sub Kategori<input id="c-sub" value="'+E(p.subKategori||'')+'"></label>'+
    '<label class="field">Satuan Dasar<input id="c-satuan" value="'+E(p.satuanDasar||'')+'"></label>'+
    '<label class="field">Status<select id="c-status"><option '+(p.status==='Aktif'?'selected':'')+'>Aktif</option><option '+(p.status==='Nonaktif'?'selected':'')+'>Nonaktif</option></select></label>'+
    '</div><div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudUpdateProduk(\''+E(kode)+'\')">Simpan</button>');
}
function crudUpdateProduk(kode){
  action(()=>{
    apiModal('ubahProduk', {kodeProduk:kode, namaProduk:$('#c-nama').value.trim(), kategori:$('#c-kat').value, subKategori:$('#c-sub').value.trim(), satuanDasar:$('#c-satuan').value.trim(), status:$('#c-status').value}, 'Produk berhasil diperbarui.');
  });
}

function crudSubmitKategori(){
  action(()=>{
    const nama=$('#c-nama').value.trim();
    if(!nama) throw Error('Nama kategori wajib diisi.');
    apiModal('tambahKategori', {namaKategori:nama}, 'Kategori berhasil ditambahkan.');
  });
}
function crudEditKategori(nama){
  modal('Edit Kategori: '+nama,
    '<label class="field">Nama baru<input id="c-nama" value="'+E(nama)+'"></label>'+
    '<label class="field">Status<select id="c-status"><option>Aktif</option><option>Nonaktif</option></select></label>'+
    '<div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudUpdateKategori(\''+E(nama)+'\')">Simpan</button>');
}
function crudUpdateKategori(namaLama){
  action(()=>{
    apiModal('ubahKategori', {namaKategoriLama:namaLama, namaKategori:$('#c-nama').value.trim(), status:$('#c-status').value}, 'Kategori berhasil diperbarui.');
  });
}

function crudSubmitSupplier(){
  action(()=>{
    const kode=$('#c-kode').value.trim(), nama=$('#c-nama').value.trim();
    if(!kode||!nama) throw Error('Kode dan nama supplier wajib diisi.');
    apiModal('tambahSupplier', {kodeSupplier:kode, namaSupplier:nama, telepon:$('#c-telp').value.trim(), rekening:$('#c-rek').value.trim()}, 'Supplier berhasil ditambahkan.');
  });
}
function crudEditSupplier(kode){
  const s = (window._masterCache?.supplier||[]).find(r=>r.kodeSupplier===kode);
  if(!s){toast('Supplier tidak ditemukan.',true);return;}
  modal('Edit Supplier: '+kode,
    '<div class="form-grid">'+
    '<label class="field">Nama<input id="c-nama" value="'+E(s.namaSupplier)+'"></label>'+
    '<label class="field">Telepon<input id="c-telp" value="'+E(s.telepon||'')+'"></label>'+
    '<label class="field">Rekening<input id="c-rek" value="'+E(s.rekening||'')+'"></label>'+
    '<label class="field">Status<select id="c-status"><option '+(s.status==='Aktif'?'selected':'')+'>Aktif</option><option>Nonaktif</option></select></label>'+
    '</div><div id="form-error" class="notice error mt" hidden></div>',
    '<button class="btn secondary" onclick="closeModal()">Batal</button><button class="btn" onclick="crudUpdateSupplier(\''+E(kode)+'\')">Simpan</button>');
}
function crudUpdateSupplier(kode){
  action(()=>{
    apiModal('ubahSupplier', {kodeSupplier:kode, namaSupplier:$('#c-nama').value.trim(), telepon:$('#c-telp').value.trim(), rekening:$('#c-rek').value.trim(), status:$('#c-status').value}, 'Supplier berhasil diperbarui.');
  });
}

function crudSubmitKatSupplier(){
  action(()=>{
    const nama=$('#c-nama').value.trim();
    if(!nama) throw Error('Nama wajib diisi.');
    apiModal('tambahKategoriSupplier', {nama}, 'Kategori supplier berhasil ditambahkan.');
  });
}
function crudSubmitLokasi(){
  action(()=>{
    const kode=$('#c-kode').value.trim(), nama=$('#c-nama').value.trim(), outlet=$('#c-outlet').value.trim();
    if(!kode||!nama) throw Error('Kode dan nama lokasi wajib diisi.');
    apiModal('tambahLokasi', {kodeLokasi:kode, namaLokasi:nama, kodeOutlet:outlet}, 'Lokasi berhasil ditambahkan.');
  });
}
function crudSubmitSatuan(){
  action(()=>{
    const kode=$('#c-kode').value.trim(), satuan=$('#c-satuan').value.trim(), faktor=Number($('#c-faktor').value);
    if(!kode) throw Error('Kode produk wajib diisi.');
    if(!satuan) throw Error('Satuan wajib diisi.');
    if(!(faktor>0)) throw Error('Faktor konversi harus positif.');
    apiModal('tambahSatuan', {kodeProduk:kode, satuan, faktorKeDasar:faktor}, 'Satuan berhasil ditambahkan.');
  });
}
function crudSubmitPengguna(){
  action(()=>{
    const id=$('#c-id').value.trim(), nama=$('#c-nama').value.trim(), peran=$('#c-peran').value, outlet=$('#c-outlet').value.trim(), lokasi=$('#c-lokasi').value.trim();
    if(!id||!nama) throw Error('ID dan Nama wajib diisi.');
    apiModal('tambahPengguna', {idPengguna:id, nama, peran, outlet, kodeLokasi:lokasi}, 'Pengguna berhasil ditambahkan. PIN ditampilkan oleh backend.');
  });
}
function crudSubmitResep(){
  action(()=>{
    const kode=$('#c-kode').value.trim(), nama=$('#c-nama').value.trim(), hasil=$('#c-hasil').value.trim();
    const jumlahHasil=Number($('#c-jumlahHasil').value), satuanHasil=$('#c-satuanHasil').value.trim();
    if(!kode||!nama) throw Error('Kode dan nama resep wajib diisi.');
    if(!hasil) throw Error('Kode produk hasil wajib diisi.');
    if(!(jumlahHasil>0)) throw Error('Jumlah hasil harus positif.');
    const bahanRows = $$('#c-bahan .crud-bahan-row');
    const bahan = bahanRows.map((row,j) => {
      const bk=$('.cb-kode',row).value.trim(), bj=Number($('.cb-jumlah',row).value), bs=$('.cb-satuan',row).value.trim(), bsus=Number($('.cb-susut',row).value)||0;
      if(!bk) throw Error('Bahan baris '+(j+1)+': kode produk wajib diisi.');
      if(!(bj>0)) throw Error('Bahan baris '+(j+1)+': jumlah harus positif.');
      return {kodeProduk:bk, jumlah:bj, satuan:bs, persenSusut:bsus};
    });
    if(!bahan.length) throw Error('Minimal satu bahan.');
    apiModal('tambahResepProduksi', {kodeResep:kode, namaResep:nama, kodeProdukHasil:hasil, jumlahHasil, satuanHasil, bahan},
      'Resep produksi berhasil ditambahkan.');
  });
}

// ============================================================
// 13. LAPORAN KADALUARSA
// ============================================================
function appExpiry(){
  return titleApp('Laporan Kadaluarsa',
    'Pantau stok yang mendekati atau sudah melewati tanggal kadaluarsa.','')+
    '<div class="form-grid mb">'+
    '<label class="field">Lokasi '+scopeSelect('exp-loc','loadExpiryReport()')+'</label>'+
    '<label class="field">Hari ke depan<input id="exp-days" type="number" min="1" value="30" onchange="loadExpiryReport()"></label>'+
    '</div>'+
    '<div id="expiry-data"><p class="small muted">Memuat data kadaluarsa...</p></div>';
}

function loadExpiryReport(){
  const loc = $('#exp-loc')?.value || S.location;
  const days = Number($('#exp-days')?.value) || 30;
  api('kadaluarsa', {kodeLokasi: loc, hariMaju: days}).then(resp => {
    const target = $('#expiry-data');
    if(!target) return;
    if(!resp || (!resp.mendekati?.length && !resp.sudah?.length)){
      target.innerHTML = '<p class="small muted">Tidak ada stok kadaluarsa dalam '+days+' hari ke depan di lokasi ini.</p>';
      return;
    }
    let html = '';
    if(resp.sudah?.length){
      html += '<h3 class="mt">Sudah kadaluarsa</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Produk</th><th>Qty</th><th>Kadaluarsa</th></tr></thead><tbody>'+
        resp.sudah.map(r=>'<tr class="row-error"><td>'+E(r.namaProduk||r.kodeProduk)+'</td><td>'+fmt(r.jumlah)+'</td><td>'+E(r.kadaluarsa)+'</td></tr>').join('')+'</tbody></table></div>';
    }
    if(resp.mendekati?.length){
      html += '<h3 class="mt">Mendekati kadaluarsa ('+days+' hari)</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Produk</th><th>Qty</th><th>Kadaluarsa</th><th>Sisa</th></tr></thead><tbody>'+
        resp.mendekati.map(r=>{
          const exp = new Date(r.kadaluarsa);
          const now = new Date();
          const sisa = Math.ceil((exp - now)/(86400000));
          return '<tr><td>'+E(r.namaProduk||r.kodeProduk)+'</td><td>'+fmt(r.jumlah)+'</td><td>'+E(r.kadaluarsa)+'</td><td>'+badge(sisa+' hari', sisa<=7?'red':'amber')+'</td></tr>';
        }).join('')+'</tbody></table></div>';
    }
    target.innerHTML = html;
  }).catch(e => {
    const target = $('#expiry-data');
    if(target) target.innerHTML = '<div class="notice error">Gagal memuat: '+E(e.message||e)+'</div>';
  });
}

// ============================================================
// 14. SheetJS loader (CDN) untuk ekspor/impor Excel
// ============================================================
if(typeof XLSX === 'undefined'){
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.async = true;
  document.head.appendChild(s);
}

// ============================================================
// 15. Refresh master cache setelah login
// ============================================================
(function(){
  const origV10Sync = v10SyncContext;
  v10SyncContext = function(){
    const result = origV10Sync.apply(this, arguments);
    if(apiToken) setTimeout(()=>loadMasterCache(), 300);
    return result;
  };
})();

console.log('TINARIS Fase 1 Batch E: 8 modul baru aktif.');
