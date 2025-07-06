# Encoding Converter for VS Code

## What is this?

Hi! This is a VS Code extension I wrote mainly because I often encounter encoding issues at work (I'm sure you know that pain ?).

You know, sometimes you receive Big5 files from colleagues, and when you open them in VS Code they're just gibberish, then you have to manually convert them to UTF-8 to read them properly. After doing this for a while it gets really annoying, so I thought I'd write a small tool to solve this problem.

## Main Features

- **Automatic encoding detection**: No need to guess what encoding the file is, the program will auto-detect
- **One-click conversion**: Right-click and convert to UTF-8
- **Batch processing**: Can convert an entire folder of files at once (super convenient!)
- **Undo functionality**: Something went wrong after conversion? There's an Undo to save you
- **Backup protection**: Automatically backs up original files, no fear of data loss

## Supported Encodings

Currently supports these encodings (should be enough):
- UTF-8, UTF-16, UTF-16BE, UTF-16LE
- Big5 (Traditional Chinese)
- GBK, GB2312 (Simplified Chinese) 
- Shift_JIS (Japanese)
- EUC-KR (Korean)
- ISO-8859-1, Windows-1252 (Western European)

## How to Use?

### Single File Conversion
1. Right-click on a file
2. Select "Convert to UTF-8" (auto-detect) or "Convert between encodings" (manual selection)
3. Done! File will automatically reopen

### Batch Conversion
1. Right-click on a folder, or select multiple files
2. Select "Batch Convert to UTF-8" or "Batch Convert between encodings"
3. Confirm the list of files to process
4. Wait for processing to complete

### Settings Adjustment
Search for "Encoding Converter" in settings to adjust:
- Whether to automatically backup
- Batch processing concurrency
- File types to exclude
- Whether to automatically reopen files after conversion

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Press `Ctrl+Shift+X` to open Extensions
3. Search for "Encoding Converter"
4. Click Install

### Manual Installation (if not yet on marketplace)
1. Download the `.vsix` file
2. In VS Code press `Ctrl+Shift+P`
3. Type "Extensions: Install from VSIX"
4. Select the downloaded file

## Notes

- Recommend restarting VS Code after first installation
- Large files (over 100MB) will show confirmation dialog
- Binary files will be automatically skipped, don't worry
- If you have issues, check the Output panel's "Encoding Converter" channel

## Development Origin

Actually I'm not some expert, just a regular developer who needs to handle files with different encodings for work. Previously I'd use Notepad's "Save As" or online tools, but switching back and forth in VS Code was annoying.

I found some similar extensions online, but they were either too complex or didn't have batch processing. So I thought I'd learn to write one myself, and practice TypeScript at the same time (still learning...).

During the writing process I also stepped on quite a few landmines, like encoding detection accuracy, backup file conflict handling, UI user experience, etc. Now it finally works, sharing it with everyone.

## Contributing

If you find bugs or have suggestions, welcome to open issues or PRs!

I know the code might not be the most elegant (still learning), but the basic functionality has been tested and should work fine. If you want to improve anything, very welcome!

## Technical Details (for those interested)

Main packages used:
- `iconv-lite`: Handles encoding conversion
- `jschardet`: Encoding detection
- `detect-file-encoding-and-language`: Additional detection assistance

Encoding detection uses a multi-layer strategy, first VS Code built-in, then jschardet, finally heuristic methods. Although not 100% accurate, it works in most cases.

## License

MIT License - use however you want, modify whatever you like

## Changelog

### v0.1.0 (2025-01-xx)
- Initial release
- Basic single file and batch conversion functionality
- Automatic encoding detection
- Undo functionality
- Settings interface

---

Hope this little tool can help everyone! Feel free to give feedback if you have issues ?

---

## 中文說明 (Chinese Description)

### 這是什麼？

這是我寫的一個VS Code編碼轉換擴展，主要解決工作中常遇到的編碼問題。支援自動檢測和轉換各種編碼，特別是Big5和UTF-8之間的轉換。

### 主要功能
- 自動檢測檔案編碼
- 單檔案和批量轉換  
- 還原功能
- 自動備份保護

### 使用方法
在檔案或資料夾上右鍵，選擇對應的轉換選項即可。

### 支援編碼
UTF-8, UTF-16, Big5, GBK, GB2312, Shift_JIS, EUC-KR, ISO-8859-1, Windows-1252等。

有問題歡迎回饋！ 