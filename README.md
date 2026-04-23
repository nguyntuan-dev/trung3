# 汉语Go – Học Tiếng Trung

Ứng dụng học tiếng Trung toàn diện với tra cứu từ điển CC-CEDICT, luyện học HSK 1-6, Flashcard và bài kiểm tra.

## 🚀 Tính năng chính

- **Tra từ điển**: Tìm kiếm bằng chữ Hán, Pinyin, tiếng Anh hoặc tiếng Việt. Dữ liệu từ hơn 120,000 từ của CC-CEDICT.
- **Học HSK**: Lộ trình học từ vựng từ HSK 1 đến HSK 6.
- **Luyện gõ 🔥**: Tính năng luyện gõ chữ Hán và Pinyin độc đáo.
- **Flashcard**: Ôn tập từ vựng với thẻ ghi nhớ thông minh.
- **Kiểm tra (Quiz)**: Đánh giá trình độ với các bài kiểm tra trắc nghiệm.
- **Dạy viết chữ**: Tích hợp HanziWriter để hướng dẫn viết chữ Hán từng nét.

## 🛠️ Cài đặt & Phát triển

### 1. Cấu trúc dự án

- `frontend/`: Chứa mã nguồn HTML, CSS và JavaScript thuần.
- `backend/`: API Backend xây dựng bằng FastAPI (Python).

### 2. Cài đặt Backend

Yêu cầu: Python 3.8+ và PostgreSQL.

1. Di chuyển vào thư mục backend:
   ```bash
   cd backend
   ```
2. Cài đặt các thư viện cần thiết:
   ```bash
   pip install -r requirements.txt
   ```
3. Cấu hình biến môi trường:
   - Tạo file `.env` dựa trên mẫu `.env.example`.
   - Cập nhật `DATABASE_URL` tới cơ sở dữ liệu PostgreSQL của bạn.
4. Chạy server:
   ```bash
   uvicorn app.main:app --reload
   ```

### 3. Cài đặt Frontend

Bạn chỉ cần mở file `frontend/index.html` trong trình duyệt hoặc sử dụng extension như Live Server trong VS Code.

## 🌐 Triển khai (Hosting)

- **Backend**: Có thể deploy lên các nền tảng như Render, Railway, hoặc DigitalOcean. Đảm bảo cấu hình biến môi trường `DATABASE_URL`.
- **Frontend**: Có thể host miễn phí trên GitHub Pages, Vercel hoặc Netlify.
- **Lưu ý**: Nếu Backend và Frontend host trên các domain khác nhau, hãy cập nhật `CORS_ORIGINS` trong file `.env` và biến `API` trong `script.js`.

## 📄 Bản quyền

Dữ liệu từ điển sử dụng từ [CC-CEDICT](https://cc-cedict.org) (CC BY-SA 3.0).
Mã nguồn phát triển bởi Team Team 汉语Go.
