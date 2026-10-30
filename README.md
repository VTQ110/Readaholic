# Readaholic

Thư viện ebook cá nhân, dùng chung với bạn bè. Giao diện chạy trên **GitHub Pages**, còn tài khoản, file sách và tiến độ đọc lưu trên **Supabase** (gói miễn phí).

- **Kệ sách**: bìa sách, tiến độ đọc của từng người, mục "Đang đọc dở".
- **Bộ lọc**: tìm theo tựa / tác giả (gõ không dấu cũng được), lọc theo thể loại, tác giả, trạng thái (chưa đọc / đang đọc / đã xong), sắp xếp.
- **Đọc trên trình duyệt**: EPUB, PDF, TXT/MD, CBZ. Có mục lục, cỡ chữ, thu phóng, nền sáng / giấy cũ / tối, phím mũi tên, vuốt trên điện thoại, nhảy tới trang.
- **Lưu tiến độ** theo tài khoản (trang + %), đồng bộ giữa các thiết bị.
- **Đăng nhập bắt buộc** bằng tài khoản do quản trị viên cấp. File sách nằm trong bucket riêng tư, chỉ thành viên đã đăng nhập mới mở được.
- **Đóng góp**: thành viên nào cũng tải sách lên được. Người tải lên hoặc quản trị viên mới sửa / xoá được sách đó.

## Triển khai (khoảng 10 phút)

### 1. Tạo Supabase

1. Tạo tài khoản và một project mới tại https://supabase.com (gói Free).
2. Vào **SQL Editor** → New query → dán toàn bộ nội dung file [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. Tạo tài khoản quản trị cho bạn, cũng trong SQL Editor:
   ```sql
   select admin_create_user('admin', 'mat-khau-cua-ban', 'Tên của bạn');
   ```
   Tài khoản đầu tiên tự động là quản trị viên.
4. **Quan trọng — tắt đăng ký tự do**: vào **Authentication → Sign In / Providers** (hoặc **Providers → Email**), tắt **Allow new users to sign up**. Như vậy chỉ người được bạn cấp tài khoản mới vào được.
5. Vào **Project Settings → API Keys / Data API**, sao chép:
   - **Project URL**, ví dụ `https://abcxyz.supabase.co`
   - **anon public key** (hoặc **publishable key**). Khoá này được phép công khai; dữ liệu được bảo vệ bằng Row Level Security trong `schema.sql`. **Đừng** dùng `service_role` / secret key.

### 2. Cấu hình GitHub

1. Repo → **Settings → Secrets and variables → Actions → tab Variables** → thêm 2 biến:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon / publishable key
2. Repo → **Settings → Pages** → mục **Source** chọn **GitHub Actions**.
   > GitHub Pages cho repo **private** cần gói GitHub Pro trở lên. Nếu dùng gói miễn phí, hãy chuyển repo sang **public** (Settings → General → Danger Zone). Việc này an toàn: trong repo không có mật khẩu hay sách, mọi dữ liệu nằm trên Supabase.
3. Vào tab **Actions** → **Deploy to GitHub Pages** → **Run workflow** (về sau mỗi lần push lên nhánh mặc định sẽ tự deploy).
4. Web chạy tại `https://<tên-github>.github.io/Readaholic/`.

### 3. Mời bạn bè

Đăng nhập → **Quản trị** → nhập tên đăng nhập, mật khẩu (có nút 🎲 tạo ngẫu nhiên) → **Tạo**, rồi gửi thông tin cho bạn bè. Ở trang Quản trị cũng có thể đặt lại mật khẩu, đổi tên, cấp/bỏ quyền quản trị, xoá tài khoản (sách họ đã góp vẫn được giữ). Mỗi người tự đổi mật khẩu bằng nút **Đổi mật khẩu**.

Quên mật khẩu quản trị: vào SQL Editor của Supabase chạy
```sql
select admin_update_user((select id from profiles where username = 'admin'), null, null, 'mat-khau-moi');
```

## Giới hạn của gói miễn phí

- Supabase Free: 1 GB lưu file, **tối đa 50 MB mỗi file**, project tự tạm dừng nếu không ai dùng trong 1 tuần (vào dashboard bấm Restore là chạy lại, dữ liệu không mất).
- MOBI/AZW3 chưa hỗ trợ — chuyển sang EPUB bằng [Calibre](https://calibre-ebook.com/) trước khi tải lên.
- Với EPUB, "trang" là trang ước lượng (~1000 ký tự) để không phụ thuộc kích thước màn hình.

## Chạy thử trên máy

```bash
npm install
cp public/js/config.example.js public/js/config.js   # điền Project URL + anon key
npm run dev                                          # mở http://localhost:8080
```

## Cấu trúc

```
public/                  Giao diện tĩnh (HTML/CSS/JS thuần)
  js/backend.js          Toàn bộ giao tiếp với Supabase (đăng nhập, sách, file, tiến độ, quản trị)
  js/library.js          Kệ sách, bộ lọc, tải lên
  js/reader.js           Trình đọc EPUB / PDF / TXT / CBZ
  js/admin.js            Quản lý tài khoản
supabase/schema.sql      Bảng, Row Level Security, bucket lưu file, hàm quản trị
scripts/build.js         Build ra dist/ (copy thư viện, sinh js/config.js từ biến môi trường)
.github/workflows/pages.yml  Tự động deploy lên GitHub Pages
```
