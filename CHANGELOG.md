# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-01-xx

### Added
- Initial release! ?
- Single file encoding conversion
- Batch convert entire folders
- Automatic encoding detection (using multiple methods)
- Undo functionality for when things go wrong
- Automatic backup so you don't lose original files
- Customizable file exclusion patterns
- Auto-reopen files after conversion

### Supported Encodings
- UTF-8, UTF-16 (various flavors)
- Big5 (Traditional Chinese)
- GBK, GB2312 (Simplified Chinese)
- Shift_JIS (Japanese)
- EUC-KR (Korean)
- ISO-8859-1, Windows-1252

### Known Issues
- Large files (over 100MB) may take some time to process
- Encoding detection isn't 100% accurate sometimes, but works most of the time

### Technical Details
- Built with TypeScript
- Uses iconv-lite for encoding conversion
- Uses jschardet and detect-file-encoding-and-language for detection
- Multi-layer encoding detection strategy for better accuracy

---

## Planned Features (Future Versions)

- [ ] Support for more encoding formats
- [ ] Better file preview functionality
- [ ] Conversion history
- [ ] Smarter encoding detection
- [ ] Maybe add a GUI interface?

If you have suggestions, feel free to open an issue! 