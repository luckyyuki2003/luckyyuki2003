/* Personal workspace. The assessment engine remains in index.html. */
(function () {
  'use strict';
  const bridge = window.__WBWorkspace;
  if (!bridge) return;
  const $ = s => document.querySelector(s);
  const clone = x => JSON.parse(JSON.stringify(x));
  const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let user = null, client = null, scope = 'guest', active = null, generation = 0;
  let timer, syncing = false, switching = false, lastSnapshot = '', cooldown = 0;
  const key = () => 'wb_workspace_v1_' + scope;
  const empty = () => ({v:1, active:null, docs:[]});
  function read() {
    const value = localStorage.getItem(key());
    if (!value) return empty();
    const data = JSON.parse(value);
    if (data.v !== 1 || !Array.isArray(data.docs)) throw Error('本机存档格式无法识别，请先备份浏览器数据。');
    return data;
  }
  function write(data) { localStorage.setItem(key(), JSON.stringify(data)); }
  function status(text, error = false) { $('#ws-status').textContent = text; $('#ws-status').dataset.error = error; }
  function message(text, error = false) { $('#ws-message').textContent = text; $('#ws-message').dataset.error = error; }
  function report(e) { status('本机保存或同步未完成，请重试', true); message(e.message || '操作失败，请重试。', true); }
  function current() { return read().docs.find(d => d.id === active); }
  function stamp() { return new Date().toISOString(); }
  function fresh(name, payload) { return {id:crypto.randomUUID(),name:name.slice(0,100),payload:clone(payload),versions:[],updated:stamp(),deleted:false,dirty:true,revision:0}; }
  function persist(force = false) {
    if (switching) return;
    const payload = bridge.capture(), serialized = JSON.stringify(payload);
    if (!force && serialized === lastSnapshot) return;
    const data = read(); let doc = data.docs.find(d => d.id === active);
    if (!doc) { doc = fresh('未命名试卷', payload); active = doc.id; data.docs.push(doc); }
    // A concurrent tab's newer snapshot is preserved as a separate document.
    if (lastSnapshot && JSON.stringify(doc.payload) !== lastSnapshot) {
      doc = fresh(doc.name + '（冲突副本）', payload); active = doc.id; data.docs.push(doc);
    } else {
      if (serialized !== JSON.stringify(doc.payload)) doc.versions.unshift({at:doc.updated,payload:clone(doc.payload)});
      doc.versions = doc.versions.slice(0,10); doc.payload = payload; doc.updated = stamp(); doc.dirty = true;
    }
    doc.name = ($('#ws-name').value.trim() || doc.name).slice(0,100);
    data.active = active; write(data); lastSnapshot = serialized;
    status('已保存到本机 · ' + new Date(doc.updated).toLocaleTimeString('zh-CN'));
    clearTimeout(timer); if (user) timer = setTimeout(() => sync().catch(report), 1200);
  }
  function openDoc(doc) {
    switching = true;
    try {
      bridge.apply(doc.payload, scope); active = doc.id; lastSnapshot = JSON.stringify(bridge.capture());
      $('#ws-name').value = doc.name; const data = read(); data.active = active;
      const stored = data.docs.find(d => d.id === active); if(stored) stored.payload = JSON.parse(lastSnapshot);
      write(data);
      status(user ? '已打开 · 等待同步' : '已保存到本机 · 游客模式');
    } finally { switching = false; }
  }
  function initializeScope() {
    const data = read(); let doc = data.docs.find(d => d.id === data.active && !d.deleted);
    if (!doc) {
      doc = fresh(user ? '新试卷' : '本机试卷', user ? bridge.blank() : bridge.capture());
      data.docs.push(doc); data.active = doc.id; write(data);
    }
    openDoc(doc);
  }
  function show(view) {
    $('#ws-view-library').hidden = view !== 'library'; $('#ws-view-account').hidden = view !== 'account';
    message(''); if (view === 'library') renderLibrary();
    if (!$('#ws-dialog').open) $('#ws-dialog').showModal();
  }
  function renderLibrary() {
    const q = $('#ws-search').value.trim().toLowerCase();
    const docs = read().docs.filter(d => d.name.toLowerCase().includes(q)).sort((a,b) => b.updated.localeCompare(a.updated));
    $('#ws-list').innerHTML = docs.map(d => `<li><strong>${esc(d.name)}${d.deleted?' · 已删除':''}</strong><small>${esc(new Date(d.updated).toLocaleString('zh-CN'))} · ${d.dirty?'仅本机 / 待同步':'已同步'}</small>${(d.deleted?['恢复']:['打开','复制','版本','删除']).map(action => `<button data-doc="${d.id}" data-action="${action}">${action}</button>`).join('')}</li>`).join('') || '<li>没有找到试卷。</li>';
  }
  async function sync() {
    if (!client || !user || syncing) return;
    const owner = user.id, run = generation; syncing = true; status('正在同步…');
    try {
      const {data:{user:verified},error:authError} = await client.auth.getUser();
      if (authError || verified?.id !== owner) throw Error('登录已过期，请重新登录；修改已保留在本机。');
      const {data:remote,error} = await client.from('workbench_documents').select('*');
      if (error) throw error;
      if (run !== generation) return;
      for (const row of remote) {
        const data = read(), local = data.docs.find(d => d.id === row.id);
        if (!local) { data.docs.push({...row.document,id:row.id,revision:row.revision,dirty:false}); write(data); }
        else if (row.revision > local.revision) {
          if (local.dirty) {
            const copy = fresh(local.name + '（冲突副本）',local.payload); copy.versions = local.versions; copy.deleted = local.deleted;
            data.docs.push(copy); if (active === local.id) { active = copy.id; data.active = copy.id; }
          }
          Object.assign(local,row.document,{id:row.id,revision:row.revision,dirty:false}); write(data);
        }
      }
      for (const doc of read().docs.filter(d => d.dirty)) {
        const snapshot = JSON.stringify(doc);
        const {data:revision,error:saveError} = await client.rpc('save_workbench_document',{
          doc_id:doc.id, expected_revision:doc.revision,
          body:{name:doc.name,payload:doc.payload,versions:doc.versions,updated:doc.updated,deleted:doc.deleted}
        });
        if (run !== generation) return;
        if (saveError) throw Error('同步未完成（可能存在其他设备修改），请重试。');
        const data = read(), live = data.docs.find(d => d.id === doc.id);
        if (live) { live.revision = revision; if (JSON.stringify({...live,revision:doc.revision}) === snapshot) live.dirty = false; write(data); }
      }
      const doc = current();
      if (doc && JSON.stringify(doc.payload) !== lastSnapshot) openDoc(doc);
      if (doc) $('#ws-name').value = doc.name;
      status(read().docs.some(d => d.dirty) ? '已保存到本机 · 仍有修改待同步' : '已同步到个人空间 · ' + new Date().toLocaleTimeString('zh-CN'));
      if ($('#ws-dialog').open && !$('#ws-view-library').hidden) renderLibrary();
    } finally { syncing = false; }
  }
  async function setUser(next) {
    if (user?.id === next?.id) return;
    persist(); clearTimeout(timer); generation++; user = next; scope = user ? user.id : 'guest';
    initializeScope(); $('#ws-account').textContent = user ? '个人账号' : '登录 / 个人空间';
    $('#ws-auth-form').hidden = !!user; $('#ws-signed-in').hidden = !user;
    $('#ws-identity').textContent = user?.email || '';
    if (user) await sync();
  }
  function run(fn) { return async (...args) => { try { await fn(...args); } catch(e) { report(e); } }; }
  $('.wrap').insertAdjacentHTML('afterbegin', `<section class="ws-hero"><div><div class="ws-eyebrow">SCIENCE · ASSESSMENT STUDIO</div><h2>让每一份试卷，更有依据</h2><p>核对题目、查看诊断、完善试卷，在这里继续你的评价设计。</p></div><div class="ws-actions"><button id="ws-new" class="primary">新建试卷</button><button id="ws-library">我的试卷</button></div></section><div class="ws-head"><label for="ws-name">当前试卷</label><input id="ws-name" maxlength="100" aria-label="试卷名称"><button id="ws-save">保存版本</button><button id="ws-sync">同步 / 重试</button><span id="ws-status" class="ws-status" role="status" aria-live="polite"></span></div>`);
  $('.tools').insertAdjacentHTML('beforeend','<button id="ws-account">登录 / 个人空间</button>');
  document.body.insertAdjacentHTML('beforeend', `<dialog id="ws-dialog" class="ws-dialog" aria-labelledby="ws-dialog-title"><header><h2 id="ws-dialog-title">个人工作空间</h2><button id="ws-close" aria-label="关闭">×</button></header><div id="ws-view-library"><div class="ws-actions"><input id="ws-search" aria-label="搜索试卷" placeholder="搜索试卷名称"></div><ul id="ws-list" class="ws-list"></ul><p>删除的试卷可恢复；每份试卷保留最近 10 次修改版本。本机空间受浏览器容量限制，请定期导出工程备份。</p><button id="ws-backup">导出当前完整工程</button></div><div id="ws-view-account"><p id="ws-config-note"></p><form id="ws-auth-form"><label for="ws-email">邮箱</label><input id="ws-email" type="email" required autocomplete="email"><button id="ws-send" type="button">发送验证码</button><label for="ws-code">邮件验证码</label><input id="ws-code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,10}"><div class="row"><button type="submit" class="primary">验证并登录</button></div></form><div id="ws-signed-in" hidden><p id="ws-identity"></p><button id="ws-migrate">将游客试卷复制到此账号</button><button id="ws-signout">退出登录</button><p>退出后返回游客空间。个人试卷的本机缓存仍保留在此浏览器，请勿在共用设备上保留敏感资料。</p></div></div><p id="ws-message" class="ws-message" role="status" aria-live="polite"></p></dialog>`);
  $('#ws-close').onclick = () => $('#ws-dialog').close();
  $('#ws-library').onclick = run(() => {persist();show('library');});
  $('#ws-account').onclick = () => show('account');
  $('#ws-search').oninput = renderLibrary;
  $('#ws-save').onclick = run(() => {persist(true);message('已保存当前版本。');});
  $('#ws-name').onchange = run(() => persist(true));
  $('#ws-sync').onclick = run(async () => {persist(); if(user) await sync(); else {show('account');message('登录后可将试卷同步到个人空间。');}});
  $('#ws-new').onclick = run(() => {persist();const data=read(),doc=fresh('新试卷',bridge.blank());data.docs.push(doc);write(data);openDoc(doc);});
  $('#ws-list').onclick = run(async event => {
    const button = event.target.closest('button'); if (!button) return;
    if(button.dataset.action==='返回'){renderLibrary();return;}
    const data = read(), doc = data.docs.find(d => d.id === button.dataset.doc); if (!doc) return;
    const action = button.dataset.action;
    if(action==='恢复版本'){
      const old=clone(doc.payload); doc.payload=clone(doc.versions[Number(button.dataset.version)].payload);
      doc.versions.unshift({at:doc.updated,payload:old});doc.versions=doc.versions.slice(0,10);doc.updated=stamp();doc.dirty=true;write(data);openDoc(doc);renderLibrary();if(user)await sync();return;
    }
    if (action === '打开') {persist();openDoc(doc);$('#ws-dialog').close();return;}
    if (action === '版本') {
      $('#ws-list').innerHTML = '<li><button data-action="返回">返回试卷列表</button></li>' + doc.versions.map((v,i) => `<li><strong>${esc(new Date(v.at).toLocaleString('zh-CN'))}</strong><button data-doc="${doc.id}" data-action="恢复版本" data-version="${i}">恢复此版本</button></li>`).join('') + (doc.versions.length?'':'<li>尚无历史版本，编辑后会自动保留。</li>');return;
    }
    if (action === '复制') data.docs.push(fresh(doc.name+'（副本）',doc.payload));
    if (action === '删除' || action === '恢复') {
      if(action==='删除' && !confirm('将此试卷移入已删除列表？之后可以恢复。'))return;
      doc.deleted=action==='删除';doc.dirty=true;doc.updated=stamp();
      if(doc.deleted && active===doc.id){const next=data.docs.find(d=>!d.deleted)||fresh('新试卷',bridge.blank());if(!data.docs.includes(next))data.docs.push(next);data.active=next.id;write(data);openDoc(next);}
    }
    write(data);renderLibrary();if(user)await sync();
  });
  $('#ws-backup').onclick = run(() => {
    persist();const blob=new Blob([JSON.stringify(bridge.capture(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='评价设计完整工程_'+stamp().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('#ws-migrate').onclick = run(async () => {
    const guest=JSON.parse(localStorage.getItem('wb_workspace_v1_guest')||'{"docs":[]}');
    const data=read();for(const d of guest.docs.filter(d=>!d.deleted))data.docs.push(fresh(d.name+'（本机导入）',d.payload));write(data);await sync();message('游客试卷已复制，原本机数据保留。');
  });
  $('#ws-signout').onclick = run(async () => {persist();const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;await setUser(null);message('已退出，现为游客空间。');});
  $('#ws-send').onclick = run(async () => {
    if(!client)throw Error('本站尚未配置云端服务，目前可使用本机保存。');
    if(!$('#ws-email').reportValidity())return;if(Date.now()<cooldown)throw Error('请稍后再发送验证码。');
    $('#ws-send').disabled=true;
    try {const {error}=await client.auth.signInWithOtp({email:$('#ws-email').value.trim()});if(error)throw error;cooldown=Date.now()+60000;message('验证码已发送，请查看邮箱。');}finally{$('#ws-send').disabled=false;}
  });
  $('#ws-auth-form').onsubmit = event => {event.preventDefault();run(async()=>{
    if(!client)throw Error('本站尚未配置云端服务。');
    const {data,error}=await client.auth.verifyOtp({email:$('#ws-email').value.trim(),token:$('#ws-code').value.trim(),type:'email'});if(error)throw error;$('#ws-code').value='';await setUser(data.user);message('登录成功。');
  })();};
  window.addEventListener('wb:changed',run(()=>persist()));
  let editTimer;
  document.addEventListener('input',event=>{
    if(event.target.closest('#ws-dialog') || event.target.id==='ws-name')return;
    clearTimeout(editTimer); editTimer=setTimeout(run(()=>persist()),600);
  });
  document.addEventListener('change',event=>{
    if(!event.target.closest('#ws-dialog') && event.target.id!=='ws-name')run(()=>persist())();
  });
  window.addEventListener('online',run(()=>sync()));
  window.addEventListener('pagehide',()=>{try{persist();}catch(e){/* previous durable copy remains */}});
  async function bootCloud() {
    const config=window.WB_CLOUD_CONFIG||{};
    $('#ws-config-note').textContent='本机模式已启用，无需注册。登录和跨设备同步暂未启用；当前数据保存在此浏览器，可导出工程备份。';
    $('#ws-auth-form').hidden=true;
    if(!config.url||!config.publishableKey)return;
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url))throw Error('云端地址必须为项目的 HTTPS Supabase 地址。');
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.js';s.onload=resolve;s.onerror=()=>reject(Error('登录服务加载失败，请检查网络后刷新。'));document.head.appendChild(s);});
    client=window.supabase.createClient(config.url,config.publishableKey);
    $('#ws-auth-form').hidden=false;
    $('#ws-config-note').textContent='使用邮箱验证码登录。登录后，你的试卷与自建题库可同步到个人空间。';
    const {data,error}=await client.auth.getSession();if(error)throw error;await setUser(data.session?.user||null);
    client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT')setTimeout(()=>setUser(null).catch(report),0);});
  }
  try {initializeScope();bootCloud().catch(report);}catch(e){report(e);}
})();
