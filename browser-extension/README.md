# Seeding Fsolution Bridge

Extension này dùng để gửi bình luận TikTok, lấy cookie Facebook khi admin bấm nút trên web và hỗ trợ đăng lần lượt vào Facebook Group bằng chính phiên Chrome của nhân viên. Web không tự đọc cookie nền; extension chỉ trả cookie khi người dùng chủ động bấm.

## Cài đặt cho khách

1. Mở Chrome và vào `chrome://extensions`.
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Chọn thư mục `browser-extension` trong source dự án.
5. Đăng nhập TikTok/Facebook trên Chrome.
6. Mở web Seeding Fsolution:
   - Vào `Lead` hoặc `TikTok CMT`, chọn video và bấm `Gửi CMT TikTok`.
   - Vào `Quản lý Cooki` -> thêm/sửa nhân sự -> bấm `Lấy từ Chrome` để lấy cookie Facebook.
   - Vào `TikTok CMT` -> `Một kênh`, dán `@username` hoặc link kênh. Extension sẽ mở kênh TikTok trong Chrome, cuộn trang để gom link video thật, rồi web mới đọc comment theo từng video.
   - Vào `Bài viết`, chọn các Facebook Group/Page rồi bấm `Đăng qua Chrome`. Extension mở lần lượt từng nơi, điền caption và tự chọn ảnh/video đã upload. Nhân viên kiểm tra preview, tự bấm `Đăng`; khi hộp soạn bài đóng, extension ghi nhận kết quả rồi chuyển sang nơi kế tiếp.

## Cập nhật extension

Khi source có thay đổi extension:

1. Mở `chrome://extensions`.
2. Bấm nút reload trên `Seeding Fsolution Bridge` hoặc bấm `Update`.
3. Đảm bảo version hiện tại là `0.1.26` trở lên.
4. Tải lại web Seeding Fsolution trước khi test lại `TikTok CMT`.

## Lưu ý vận hành

- Không cần dán cookie TikTok vào web để gửi comment.
- Lấy comment theo kênh TikTok cần extension đang bật, vì TikTok chỉ hiện đủ danh sách video sau khi Chrome render/scroll trang kênh.
- Khi bấm gửi TikTok từ UI, web sẽ thử gửi trực tiếp qua extension bằng tab TikTok đang đăng nhập. Nếu TikTok chặn/captcha/không nhận, web sẽ fallback sang copy nội dung và mở video để sale gửi thủ công.
- Khi trả lời TikTok từ Inbox, extension sẽ ưu tiên mở link `?comment=<cid>`, sau đó tự cuộn panel bình luận để tìm comment, tô xanh nếu thấy và ghim bảng xử lý. Chỉ cuộn trong panel comment, không cuộn feed video.
- Facebook cookie chỉ được lấy khi admin bấm nút, không tự động thu thập nền.
- Chế độ Facebook Group không tự bấm nút `Đăng`. Nhân viên là người xác nhận hành động cuối; extension chỉ ghi nhận hộp soạn bài đã đóng rồi chuyển Group tiếp theo.
- Caption và file ảnh/video công khai đã upload trên màn `Bài viết` được điền/chọn tự động. Extension chỉ thao tác trong dialog `Tạo bài viết`, không dùng ô bình luận làm phương án dự phòng, ưu tiên paste tương thích Facebook Lexical và không chèn lại caption khi nhận retry. Bản 0.1.26 tự thay hàng đợi cũ đang chờ khi người dùng bắt đầu lượt đăng mới; extension sẽ dừng và báo lỗi nếu không tải hoặc gắn được media.
- Link YouTube/TikTok hoặc URL không trỏ trực tiếp tới file media được chèn vào caption để Facebook tạo link preview, không được tải thành file.
- Nếu TikTok hỏi đăng nhập lại, hãy đăng nhập trực tiếp trên tab TikTok rồi bấm gửi lại.
- Extension chỉ gửi khi người dùng bấm nút, không có chế độ tự spam hoặc chạy nền hàng loạt.
