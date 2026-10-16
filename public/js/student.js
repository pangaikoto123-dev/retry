document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('attend-form');
  const msg = document.getElementById('msg');
  const code = location.pathname.split('/r/')[1] || '';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const grade = document.getElementById('grade').value;
    const section = document.getElementById('section').value;
    const res = await fetch(`/api/attend/${encodeURIComponent(code)}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, grade, section }) });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = 'Attendance submitted. Thank you!';
      form.reset();
    } else {
      msg.textContent = data.error || 'Could not submit';
    }
  });
});
