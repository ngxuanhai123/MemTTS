# 🔊 Memrise TTS Vocabulary Reader

![Version](https://img.shields.io/badge/version-4.0-blue)
![Tampermonkey](https://img.shields.io/badge/Tampermonkey-%E2%9C%93-00485B)
![Feature](https://img.shields.io/badge/feature-Text--to--Speech-4285F4)
![Platform](https://img.shields.io/badge/supports-Memrise%20Classic%20%2B%20Modern-green)
![Engine](https://img.shields.io/badge/engine-Web%20Speech%20API-orange)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

> 🎧 Trình đọc phát âm từ vựng Text-to-Speech (TTS) chuyên nghiệp dành cho **Memrise** (hỗ trợ cả Memrise hiện đại và Memrise Community Courses cổ điển). Tự động nhận diện từ vựng, tự chọn giọng đọc chất lượng cao (Neural/Natural), khắc phục triệt để lỗi Chrome GC freeze, chế độ lặp lại thông minh và tối ưu hóa DOM tuyệt đối!

---

## 📖 Giới thiệu

Khi học từ vựng trên Memrise, nhiều khóa học cộng đồng hoặc bài học mới không có sẵn file ghi âm audio bản địa, hoặc âm thanh tải chậm làm gián đoạn nhịp học.

**Memrise TTS Vocabulary Reader v4.0** biến trình duyệt của bạn thành một cỗ máy phát âm bản ngữ siêu tốc:
- Tự động nhận biết câu hỏi/từ vựng đang hiển thị trên màn hình và đọc to ngay lập tức bằng giọng đọc chuẩn xác.
- Tự động làm sạch văn bản (loại bỏ phiên âm IPA, từ loại, số thứ tự, emoji loa) để phát âm tự nhiên nhất.
- Giải quyết triệt để lỗi kinh điển của Google Chrome/Chromium: **V8 Garbage Collection bug 799003** làm ngắt tiếng giữa chừng và bug đơ sau 15 giây.

---

## 🎯 Tính năng nổi bật

| Tính năng | Chi tiết |
|-----------|---------|
| 🧠 **Tự động nhận diện (Auto-detect)** | Hệ thống tính điểm ưu tiên (`Priority Scoring`) tự động quét từ vựng trên cả Memrise Modern (`data-testid`) lẫn Classic Community Courses (`.thing .text`, `.qquestion`). |
| 🧹 **Bộ lọc văn bản thông minh (Text Sanitizer)** | Tự động loại bỏ phiên âm IPA `[/.../]`, nhãn từ loại `(noun)`, `(v.)`, số thứ tự `1. `, `• ` và biểu tượng âm thanh trước khi đọc. |
| 🌟 **Bộ lọc giọng đọc cao cấp (Neural/Natural)** | Tự động ưu tiên các giọng đọc trực tuyến, giọng trí tuệ nhân tạo (Online, Neural, Natural, Google, Premium, Microsoft Jenny, Guy, Aria, v.v.). |
| 🛡️ **Khắc phục Chromium GC Bug 799003** | Duy trì tập hợp tham chiếu mạnh (`activeUtterances = new Set()`) ngăn chặn trình dọn rác V8 ngắt ngang âm thanh khi đang đọc. |
| ⏱️ **Chrome 15s Freeze Keep-Alive** | Cơ chế tự động kích hoạt lại kênh audio mỗi 10 giây, loại bỏ hoàn toàn lỗi đóng băng SpeechSynthesis của Chromium. |
| 🔁 **Chế độ Lặp lại nâng cao (Repeat Mode)** | Tùy chỉnh số lần lặp lại (1 - 20 lần) và khoảng cách nghỉ giữa các lần lặp, đi kèm thanh đếm ngược tiến trình trực quan. |
| 🎯 **Bộ chọn vị trí thủ công (Pick Mode)** | Cho phép click trực tiếp vào phần tử trên trang để ghim vị trí đọc riêng cho các khóa học có cấu trúc đặc biệt. |
| 📐 **Bảng điều khiển co giãn (Resizable Panel)** | Bảng điều khiển màu tối (Dark Mode) sang trọng, có tay cầm ở góc trên bên trái để thu phóng kích thước tùy ý. |
| ⚡ **Tối ưu hóa DOM & SPA Route Hooks** | Lắng nghe DOM bằng `requestAnimationFrame` + debounce 120ms và bắt sự kiện chuyển bài Single Page App mà không gây tụt FPS. |

---

## 🚀 Cài đặt

### Cách 1: Cài đặt trực tiếp (Khuyến nghị)

1. Cài đặt tiện ích mở rộng **Tampermonkey**:
   - [Tampermonkey cho Google Chrome / Edge](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Tampermonkey cho Mozilla Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
2. Nhấp vào đường dẫn cài đặt chính thức:  
   👉 **[Cài đặt Memrise TTS Reader (TTS Vocabulary.js)](https://raw.githubusercontent.com/ngxuanhai123/MemTTS/refs/heads/main/TTS%20Vocabulary.js)**
3. Nhấp chọn **Install** (hoặc **Cập nhật**).

### Cách 2: Cài đặt thủ công

1. Mở tiện ích Tampermonkey -> Chọn **Create a new script** (+).
2. Xóa sạch mã mẫu ban đầu.
3. Dán toàn bộ nội dung file [`TTS Vocabulary.js`](TTS%20Vocabulary.js) vào trình soạn thảo.
4. Nhấn **Ctrl + S** để lưu.

---

## 💡 Hướng dẫn sử dụng

### 1. Bắt đầu học
- Truy cập vào **[Memrise](https://www.memrise.com/)** hoặc **[Community Courses](https://community-courses.memrise.com/)**.
- Bắt đầu bài học từ vựng bất kỳ.
- Nút tròn nổi biểu tượng loa **🔊 (FAB)** sẽ xuất hiện ở góc dưới bên phải màn hình.
- Khi chuyển sang từ mới, script sẽ tự động đọc từ vựng đó lên.

### 2. Các trạng thái của nút nổi FAB (🔊)
- **Đang đọc:** Nút phát xung động (`pulse animation`).
- **Đang trong chu kỳ lặp lại:** Nút đổi sang màu xanh lá (`emerald glow`) kèm huy hiệu hiển thị số lần lặp còn lại.
- **Có từ vựng mới:** Nút chớp sáng viền màu hổ phách (`amber flash`).
- **Click 1 lần:** Mở/đóng bảng điều khiển chi tiết.
- **Double click:** Bật/tắt nhanh toàn bộ tính năng TTS.

### 3. Bảng điều khiển (Control Panel)
- **Bật TTS / Tự đọc:** Bật hoặc tắt chức năng phát âm tự động khi chuyển câu.
- **Ngôn ngữ:** Hỗ trợ 12 ngôn ngữ phổ biến: Tiếng Anh (Mỹ/Anh), Tiếng Việt, Tiếng Nhật, Tiếng Hàn, Tiếng Trung (Giản/Phồn), Tiếng Pháp, Tiếng Đức, Tiếng Tây Ban Nha, Tiếng Nga, Tiếng Indonesia.
- **Giọng đọc:** Chọn một giọng cụ thể hoặc để chế độ **✨ Tự động** để script tự chọn giọng tốt nhất trong hệ điều hành.
- **Tốc độ (Rate) & Cao độ (Pitch):** Thanh trượt mượt mà từ 0.5x đến 2.0x.
- **Lặp lại tự động:** Thiết lập số lần lặp (ví dụ: lặp lại 3 lần) và thời gian giãn cách (ví dụ: cách nhau 2.5 giây). Có thanh đếm ngược tiến trình thời gian thực.
- **Chọn vị trí (Pick Mode):** Nhấp nút **✚ Chọn vị trí** và click vào từ vựng trên màn hình để lưu vị trí ưu tiên.

---

## ⚙️ Các thông số cấu hình mặc định

```javascript
const defaultConfig = {
  enabled: true,         // Bật tính năng phát âm
  lang: 'en-US',         // Ngôn ngữ mặc định
  voiceName: '',         // Rỗng = tự động chọn giọng tốt nhất
  rate: 1.0,             // Tốc độ phát âm (0.5x - 2.0x)
  pitch: 1.0,            // Cao độ giọng đọc (0.5 - 2.0)
  volume: 1.0,           // Âm lượng (0.0 - 1.0)
  autoRead: true,        // Tự động đọc khi xuất hiện từ mới
  savedSelectors: [],    // Danh sách vị trí tùy biến người dùng đã lưu
  repeatCount: 0,        // Số lần lặp lại (0 = tắt)
  repeatInterval: 3.0,   // Khoảng cách giữa các lần lặp (giây)
  panelWidth: 320,       // Chiều rộng bảng điều khiển (px)
  panelHeight: 560,      // Chiều cao tối đa bảng điều khiển (px)
};
```

---

## 🏗️ Kiến trúc & Giải pháp kỹ thuật chuyên sâu

### 1. Thuật toán làm sạch từ vựng (`sanitizeText`)
Trước khi đưa chuỗi ký tự vào bộ phát âm, dữ liệu thô được chuẩn hóa qua 6 bước nghiêm ngặt:
1. Giải mã toàn bộ thực thể HTML (`&amp;`, `&quot;`, `&#39;`...).
2. Loại bỏ biểu tượng đồ họa, icon loa, micro: `\u{1F50A}`, `\u{1F3A4}`, `\u{25B6}`...
3. Loại bỏ phiên âm quốc tế IPA nằm trong ngoặc vuông `[...]` hoặc gạch chéo `/.../`.
4. Loại bỏ nhãn từ loại ngữ pháp: `(noun)`, `(v.)`, `(adj)`, `(phrase)`, `idiom`, `colloquial`...
5. Loại bỏ đánh số thứ tự đầu dòng: `1. `, `2) `, `- `, `• `.
6. Chuẩn hóa khoảng trắng dư thừa.

### 2. Hệ thống tính điểm bộ chọn (`Heuristic Scoring Engine`)
Hàm `pickBestTextElement()` hoạt động theo thứ bậc:
1. **Ưu tiên 1:** Quét danh sách bộ chọn do người dùng tự ghim (`config.savedSelectors`).
2. **Ưu tiên 2:** Quét danh sách `MEMRISE_AUTO_SELECTORS` kết hợp thuật toán tính điểm:
   - Điểm cơ sở theo độ ưu tiên của selector (từ 80 đến 130 điểm).
   - **+25 điểm** nếu node là phần tử lá (không chứa nút bấm, audio, input lồng bên trong).
   - **+20 điểm** nếu từ vựng ngắn gọn (dưới 5 từ).
   - Tự động bỏ qua phần tử ẩn (`offsetParent === null`) và phần tử dài bất thường (>250 ký tự).

### 3. Giải pháp triệt tiêu lỗi Chromium Garbage Collection
```javascript
const activeUtterances = new Set();

// Trước khi phát âm:
activeUtterances.add(utter);

// Khi kết thúc hoặc gặp lỗi:
utter.onend = () => { activeUtterances.delete(utter); ... };
utter.onerror = () => { activeUtterances.delete(utter); ... };
```
*Nguyên lý:* Trong V8 Engine của Google Chrome, nếu một đối tượng `SpeechSynthesisUtterance` không được lưu vào một biến phạm vi toàn cục lâu dài, Garbage Collector có thể thu hồi bộ nhớ của nó ngay khi đang nói, khiến sự kiện `onend` không bao giờ được kích hoạt và âm thanh bị ngắt đột ngột. Bằng việc lưu vào `Set` toàn cục, đối tượng được bảo vệ 100% trong suốt quá trình phát âm.

### 4. Kỹ thuật đánh thức động cơ phát âm (`Engine Pre-warming`)
Hàm `warmUpEngine()` tự động phát một ký tự khoảng trắng không ngắt (`\u00A0`) với âm lượng `volume = 0` và tốc độ cực đại ngay khi trang tải xong. Kỹ thuật này giúp khởi động sẵn tiến trình audio driver của hệ điều hành, đảm bảo từ vựng đầu tiên khi bắt đầu học sẽ phát ra ngay lập tức mà không bị trễ (zero-latency).

### 5. Tối ưu hóa hiệu năng vòng đời DOM (`Mutation Batching`)
Thay vì phản hồi tức thì với hàng trăm biến động DOM mỗi giây của React/Vue, script sử dụng kỹ thuật:
- Chỉ theo dõi `childList: true`, bỏ qua hoàn toàn `attributes` và `characterData`.
- Gom nhóm các biến đổi DOM thông qua `requestAnimationFrame`.
- Trì hoãn xử lý bằng bộ đệm Debounce 120ms trước khi kiểm tra từ mới.

---

## 🛠️ Công nghệ sử dụng

| Công nghệ | Mục đích |
|-----------|----------|
| **JavaScript (ES6+)** | Lõi xử lý toàn bộ logic ứng dụng |
| **Web Speech API** | Công nghệ Text-to-Speech nguyên bản của trình duyệt |
| **Tampermonkey API** | Quản lý lưu trữ (`GM_getValue`, `GM_setValue`) và chèn CSS (`GM_addStyle`) |
| **MutationObserver** | Theo dõi biến động giao diện khi chuyển câu hỏi |
| **History API Hooking** | Bắt sự kiện chuyển trang của Single Page Application (SPA) |
| **Pointer & Mouse Events** | Xử lý kéo thả co giãn kích thước panel |

---

## 🔗 Liên kết liên quan

- 📦 **Cài đặt script:** https://raw.githubusercontent.com/ngxuanhai123/MemTTS/refs/heads/main/TTS%20Vocabulary.js
- 📂 **Kho lưu trữ GitHub:** https://github.com/ngxuanhai123/MemTTS

---

## ✍️ Tác giả

[**Ng Xuan Hai**](https://github.com/ngxuanhai123) & **Claude**
