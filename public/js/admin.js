const $ = (id) => document.getElementById(id);
let me = null;

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function update(user, body, message) {
  try {
    await api(`/api/users/${user.id}`, { method: 'PUT', body });
    toast(message);
    load();
  } catch (err) {
    alert(err.message);
  }
}

function row(user) {
  const isMe = user.id === me.id;
  return el(
    'tr', {},
    el('td', {}, el('strong', { text: user.username }), isMe ? el('span', { class: 'muted', text: ' (bạn)' }) : null),
    el('td', { text: user.displayName }),
    el('td', { class: user.role === 'admin' ? 'role-admin' : '', text: user.role === 'admin' ? 'Quản trị viên' : 'Thành viên' }),
    el('td', { text: user.bookCount }),
    el('td', { text: formatDate(user.createdAt) }),
    el('td', {}, el('div', { class: 'actions' },
      el('button', { class: 'btn btn-sm', type: 'button', text: 'Đổi tên', onclick: () => {
        const name = prompt(`Tên hiển thị mới cho ${user.username}:`, user.displayName);
        if (name !== null) update(user, { displayName: name }, 'Đã đổi tên');
      } }),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'Đặt lại mật khẩu', onclick: () => {
        const pw = prompt(`Mật khẩu mới cho ${user.username} (ít nhất 6 ký tự):`, randomPassword());
        if (pw) update(user, { password: pw }, `Đã đặt mật khẩu mới cho ${user.username}: ${pw}`);
      } }),
      isMe ? null : el('button', { class: 'btn btn-sm', type: 'button',
        text: user.role === 'admin' ? 'Bỏ quyền quản trị' : 'Cấp quyền quản trị',
        onclick: () => update(user, { role: user.role === 'admin' ? 'member' : 'admin' }, 'Đã cập nhật vai trò') }),
      isMe ? null : el('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Xoá', onclick: async () => {
        if (!confirm(`Xoá tài khoản "${user.username}"? Sách họ đã góp vẫn được giữ lại.`)) return;
        try {
          await api(`/api/users/${user.id}`, { method: 'DELETE' });
          toast('Đã xoá tài khoản');
          load();
        } catch (err) {
          alert(err.message);
        }
      } })
    ))
  );
}

async function load() {
  const users = await api('/api/users');
  $('users').replaceChildren(...users.map(row));
}

$('gen-btn').addEventListener('click', () => ($('c-password').value = randomPassword()));
$('logout-btn').addEventListener('click', logout);
$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('create-error').textContent = '';
  const body = { username: $('c-username').value.trim(), displayName: $('c-name').value, password: $('c-password').value, role: $('c-role').value };
  try {
    await api('/api/users', { method: 'POST', body });
    alert(`Đã tạo tài khoản. Gửi thông tin này cho bạn của bạn:\n\nĐịa chỉ: ${location.origin}\nTên đăng nhập: ${body.username}\nMật khẩu: ${body.password}`);
    e.target.reset();
    load();
  } catch (err) {
    $('create-error').textContent = err.message;
  }
});

(async () => {
  me = await api('/api/me');
  load();
})();
