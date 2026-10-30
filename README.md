# Readaholic

Thư viện ebook cá nhân, dùng chung với bạn bè.

- **Kệ sách**: hiển thị bìa, tiến độ đọc của từng người; mục "Đang đọc dở" để đọc tiếp nhanh.
- **Bộ lọc**: tìm theo tựa / tác giả (gõ không dấu cũng được), lọc theo thể loại, tác giả, trạng thái (chưa đọc / đang đọc / đã xong), sắp xếp.
- **Đọc trực tiếp trên trình duyệt**: EPUB, PDF, TXT/MD, CBZ (truyện tranh). Có mục lục (EPUB), chỉnh cỡ chữ, thu phóng, nền sáng / giấy cũ / tối, phím mũi tên, vuốt trên điện thoại, nhảy tới trang.
- **Lưu tiến độ** cho từng tài khoản: trang đang đọc và phần trăm, tự lưu khi lật trang và khi đóng tab.
- **Đăng nhập bắt buộc**: chỉ người có tài khoản do quản trị viên cấp mới vào được; file sách cũng được bảo vệ.
- **Đóng góp**: mọi thành viên đều tải sách lên được (tự đọc tựa, tác giả, ảnh bìa từ EPUB/PDF/CBZ). Người tải lên hoặc quản trị viên mới sửa/xoá được sách đó.

## Chạy

Cần Node.js 20 trở lên.

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=doimatkhaunay npm start
```

Mở http://localhost:3000 và đăng nhập. Tài khoản quản trị chỉ được tạo từ biến môi trường ở lần chạy đầu tiên (khi chưa có ai), các lần sau chỉ cần `npm start`.

Vào trang **Quản trị** để cấp tài khoản cho bạn bè (có nút tạo mật khẩu ngẫu nhiên), đặt lại mật khẩu, cấp/bỏ quyền quản trị. Mỗi người tự đổi mật khẩu ở nút "Đổi mật khẩu".

Tạo hoặc đặt lại tài khoản từ dòng lệnh (ví dụ khi quên mật khẩu quản trị):

```bash
npm run create-user -- ten_dang_nhap matkhau --admin --name "Tên hiển thị"
```

### Docker

```bash
docker build -t readaholic .
docker run -d -p 3000:3000 -v readaholic-data:/data \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=doimatkhaunay readaholic
```

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `3000` | Cổng web |
| `DATA_DIR` | `./data` | Nơi lưu database SQLite, file sách và ảnh bìa — **hãy sao lưu thư mục này** |
| `MAX_UPLOAD_MB` | `200` | Dung lượng tối đa mỗi file sách |
| `SESSION_DAYS` | `30` | Số ngày giữ đăng nhập |
| `SECURE_COOKIES` | `false` | Đặt `true` khi chạy sau HTTPS |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | | Tạo quản trị viên đầu tiên |

Khi chia sẻ cho bạn bè qua Internet, nên đặt sau một reverse proxy có HTTPS (Caddy, Nginx, Cloudflare Tunnel…) và bật `SECURE_COOKIES=true`, để mật khẩu không bị gửi dạng rõ.

## Định dạng

| Định dạng | Hỗ trợ |
| --- | --- |
| EPUB | Đọc dạng lật trang, mục lục, cỡ chữ, tự lấy tựa/tác giả/bìa |
| PDF | Theo trang, thu phóng, tự lấy bìa từ trang đầu |
| TXT, MD | Cuộn, cỡ chữ, tự nhận mã hoá UTF-8 / Windows-1258 |
| CBZ | Theo trang ảnh, thu phóng |

MOBI/AZW3 chưa hỗ trợ — có thể chuyển sang EPUB bằng [Calibre](https://calibre-ebook.com/) trước khi tải lên.

Với EPUB, "trang" là trang ước lượng (khoảng 1000 ký tự) để số trang không phụ thuộc kích thước màn hình.

## Cấu trúc

```
server.js            Express server, phân quyền trang
src/db.js            Schema SQLite (users, sessions, books, progress)
src/auth.js          Băm mật khẩu (scrypt), phiên đăng nhập, chống dò mật khẩu
src/routes/          API: đăng nhập, sách + tiến độ, quản lý người dùng
public/              Giao diện (HTML/CSS/JS thuần, không cần build)
scripts/create-user.js
```
