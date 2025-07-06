# Development Notes

These are some development notes for myself and anyone who wants to understand the project.

## Project Structure

```
encoding-converter/
¢u¢w¢w src/
¢x   ¢|¢w¢w extension.ts          # Main extension logic
¢u¢w¢w package.json              # Extension configuration
¢u¢w¢w tsconfig.json             # TypeScript config
¢|¢w¢w .vscode/
    ¢u¢w¢w launch.json           # Debug configuration
    ¢|¢w¢w tasks.json            # Build tasks
```

## Main Features Implementation

### Encoding Detection
Using a multi-layer detection approach:
1. VS Code built-in detection
2. jschardet detection
3. detect-file-encoding-and-language
4. Finally, heuristic methods (self-written)

### Conversion Flow
1. Detect original encoding
2. Decode using iconv-lite
3. Convert to target encoding
4. Write to file
5. Reopen file

### Batch Processing
Using concurrency control, default 5 files at a time. Too many would freeze VS Code.

## Lessons Learned

### 1. Encoding Detection Accuracy
Initially only used jschardet, but it wasn't accurate for some files. Added multiple detection methods - not 100% but much better now.

### 2. File Reopening Timing
Originally showed success message first, then reopened file. But user experience wasn't good, changed to reopen first then show message.

### 3. Backup File Name Conflicts
If .bak already existed it would overwrite. Changed to .bak.1, .bak.2 etc. incremental naming.

### 4. Large File Handling
Initially had no limits, processing hundreds of MB would crash VS Code. Added warnings and confirmation dialogs.

### 5. Undo Functionality
During implementation, realized we need to remember original encoding, otherwise don't know what encoding to use when restoring.

## Technical Choices

### Why iconv-lite?
- Supports the most encodings
- Clear documentation
- Actively maintained

### Why jschardet?
- More accurate
- Lightweight
- But not great for some Asian languages, so added other detection methods

## Performance Considerations

- Use concurrency control to avoid processing too many files
- Large file warnings
- Auto-skip binary files
- File detection uses multiple methods but with confidence thresholds

## TODO

- [ ] Add more encoding support
- [ ] Better progress display
- [ ] Maybe add conversion history?
- [ ] UI improvements
- [ ] More comprehensive testing

## Debugging Tips

Press F5 to open debug mode, which opens a new VS Code window for testing the extension.

For logs, go to Output panel and select "Encoding Converter".

## References

- [VS Code Extension Development Docs](https://code.visualstudio.com/api)
- [iconv-lite Documentation](https://github.com/ashtuchkin/iconv-lite)
- [jschardet Documentation](https://github.com/aadsm/jschardet)

Writing extensions is more complex than I imagined, but quite fun! 