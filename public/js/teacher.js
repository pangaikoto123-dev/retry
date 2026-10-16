document.addEventListener('DOMContentLoaded', () => {
  const signupBtn = document.getElementById('signup');
  const loginBtn = document.getElementById('login');
  const createBtn = document.getElementById('create-qr');
  const qrsDiv = document.getElementById('qrs');
  const authMsg = document.getElementById('auth-msg');
  const teacherNameSpan = document.getElementById('teacher-name');

  function saveToken(token) { localStorage.setItem('token', token); }
  function getToken() { return localStorage.getItem('token'); }

  async function signup() {
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const res = await fetch('/api/signup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name, email, password})});
    const data = await res.json();
    if (res.ok) { saveToken(data.token); setupDashboard(data.teacher); } else { authMsg.textContent = data.error || 'signup failed'; }
  }

  async function login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email, password})});
    const data = await res.json();
    if (res.ok) { saveToken(data.token); setupDashboard(data.teacher); } else { authMsg.textContent = data.error || 'login failed'; }
  }

  async function createQR() {
    const token = getToken();
    const res = await fetch('/api/qr', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }});
    const data = await res.json();
    if (res.ok) { loadQRs(); } else { alert(data.error || 'could not create'); }
  }

  async function loadQRs() {
    const token = getToken();
    const res = await fetch('/api/qr', { headers: { 'Authorization': 'Bearer ' + token }});
    const data = await res.json();
    if (!res.ok) { console.error(data); return; }
    qrsDiv.innerHTML = '';
    data.qrs.forEach(q => {
      const el = document.createElement('div');
      el.className = 'qr-item';
      const link = `${location.origin}/r/${q.code}`;
      el.innerHTML = `
        <div><strong>Code:</strong> ${q.code} <small>(${new Date(q.created_at).toLocaleString()})</small></div>
        <div><a target="_blank" href="${link}">Open student page</a></div>
        <div><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}" alt="qr"></div>
        <div><button data-id="${q.id}" class="show-students">Show students</button></div>
        <div class="students" id="students-${q.id}"></div>
      `;
      qrsDiv.appendChild(el);
    });
    document.querySelectorAll('.show-students').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const token = getToken();
        const res = await fetch(`/api/qr/${id}/students`, { headers: { 'Authorization': 'Bearer ' + token }});
        const data = await res.json();
        const container = document.getElementById('students-' + id);
        if (!res.ok) { container.textContent = data.error || 'error'; return; }
        if (data.students.length === 0) container.textContent = 'No submissions yet'; else {
          container.innerHTML = '<ul>' + data.students.map(s => `<li>${new Date(s.created_at).toLocaleString()} — ${s.name} (Grade ${s.grade} • ${s.section})</li>`).join('') + '</ul>';
        }
      });
    });
  }

  function setupDashboard(teacher) {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    teacherNameSpan.textContent = teacher.name || teacher.email;
    loadQRs();
  }

  signupBtn.addEventListener('click', signup);
  loginBtn.addEventListener('click', login);
  createBtn.addEventListener('click', createQR);

  // auto-login if token exists
  const token = getToken();
  if (token) {
    // decode simple payload (not verifying) to show name; real apps should verify server-side
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setupDashboard({ name: payload.name || payload.email, email: payload.email, id: payload.id });
    } catch (e) {
      // ignore
    }
  }
});
