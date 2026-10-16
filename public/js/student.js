document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('attend-form');
  const msg = document.getElementById('msg');

  const params = new URLSearchParams(location.search);
  const codeFromQuery = params.get('code');
  const codeFromPath = (location.pathname.includes('/r/') ? location.pathname.split('/r/')[1] : null);
  const code = (codeFromQuery || codeFromPath || '').replace(/[^A-Za-z0-9_-]/g, '');

  if (!code) {
    msg.textContent = 'Invalid or missing QR code.';
    form.style.display = 'none';
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value.trim();
    const grade = document.getElementById('grade').value.trim();
    const section = document.getElementById('section').value.trim();

    if (!name || !grade || !section) {
      msg.textContent = 'Please fill all fields.';
      return;
    }

    try {
      const res = await fetch(`/api/attend/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, grade, section })
      });
      const data = await res.json();
      if (res.ok) {
        msg.textContent = 'Attendance submitted. Thank you!';
        form.reset();
      } else {
        msg.textContent = data.error || 'Could not submit';
      }
    } catch (err) {
      msg.textContent = 'Network error. Please try again.';
      console.error(err);
    }
  });
});
