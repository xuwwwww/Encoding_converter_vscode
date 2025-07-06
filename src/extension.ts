/**
 * VS Code Encoding Converter Extension
 * 
 * This extension is mainly written to solve encoding problems I encounter at work
 * Supports automatic detection and conversion of various encodings, especially between Big5 and UTF-8
 * 
 * Main features:
 * - Automatic file encoding detection
 * - Single file and batch conversion
 * - Backup and Undo functionality
 * - Support for multiple Asian language encodings
 * 
 * Author: LouisXuwwww
 * Written mainly for work needs, and also to learn TypeScript and VS Code extension development
 */

import * as vscode from 'vscode';
import * as iconv from 'iconv-lite';
import * as jschardet from 'jschardet';
import detectFile from 'detect-file-encoding-and-language';
import * as path from 'path';

// Configuration interface
interface EncodingConverterConfig {
    batchConcurrency: number;
    createBackup: boolean;
    showDetailedResults: boolean;
    excludePatterns: string[];
    autoReopenFiles: boolean;
}

// Result interfaces
interface ConversionResult {
    success: boolean;
    filePath: string;
    originalEncoding?: string;
    targetEncoding?: string;
    fileSize?: number;
    error?: string;
    skipped?: boolean;
    skipReason?: string;
    backupCreated?: boolean;
    detectedOriginalEncoding?: string; // The actual detected encoding before conversion
}

interface BatchConversionResult {
    totalFiles: number;
    processed: number;
    converted: number;
    skipped: number;
    errors: number;
    results: ConversionResult[];
}

// Output channel for logging
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    console.log('Encoding Converter is now active!');
    
    // Initialize output channel
    outputChannel = vscode.window.createOutputChannel('Encoding Converter');
    context.subscriptions.push(outputChannel);
    
    // Check if this is a fresh installation or update
    const currentVersion = context.extension.packageJSON.version;
    const lastVersion = context.globalState.get<string>('lastVersion', '');
    
    // Show restart prompt if version changed (installation or update)
    if (currentVersion !== lastVersion) {
        // Update stored version
        context.globalState.update('lastVersion', currentVersion);
        
        // Show restart prompt
        vscode.window.showInformationMessage(
            'Encoding Converter installed successfully! Please restart VS Code for the extension to work properly.',
            'Restart Now',
            'Dismiss'
        ).then(selection => {
            if (selection === 'Restart Now') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    } else {
        // Only show activation message in development
        console.log('Encoding Converter extension activated!');
    }

    /**
     * Get configuration settings
     * Centralize all settings here for easy management
     */
    function getConfig(): EncodingConverterConfig {
        const config = vscode.workspace.getConfiguration('encodingConverter');
        return {
            batchConcurrency: config.get<number>('batchConcurrency', 5),
            createBackup: config.get<boolean>('createBackup', true),
            showDetailedResults: config.get<boolean>('showDetailedResults', true),
            excludePatterns: config.get<string[]>('excludePatterns', [
                '*.exe', '*.dll', '*.so', '*.dylib', '*.bin', '*.pdf', 
                '*.jpg', '*.png', '*.gif', '*.zip', '*.tar', '*.gz'
            ]),
            autoReopenFiles: config.get<boolean>('autoReopenFiles', true)
        };
    }

    /**
     * Log message to output channel
     */
    function log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        outputChannel.appendLine(logMessage);
        console.log(logMessage);
    }

    /**
     * Check if file should be processed
     * This function filters out files that don't need processing, avoiding binary files
     */
    function shouldProcessFile(uri: vscode.Uri, config: EncodingConverterConfig): { shouldProcess: boolean; reason?: string } {
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);
        const fileExtension = path.extname(fileName).toLowerCase();
        
        // Skip untitled files (unsaved files)
        if (uri.scheme === 'untitled' || filePath.startsWith('untitled:')) {
            return { shouldProcess: false, reason: 'Untitled/unsaved file' };
        }
        
        // Check exclude patterns
        for (const pattern of config.excludePatterns) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
            if (regex.test(fileName)) {
                return { shouldProcess: false, reason: `Excluded by pattern: ${pattern}` };
            }
        }
        
        // Check common binary file extensions
        // This list has been accumulated over time to avoid processing binary files
        const binaryExtensions = [
            '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o', '.a', '.lib',
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.ico', '.webp',
            '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.wav', '.ogg',
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.lzma',
            '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'
        ];
        
        if (binaryExtensions.includes(fileExtension)) {
            return { shouldProcess: false, reason: 'Binary file type' };
        }
        
        return { shouldProcess: true };
    }

    /**
     * Get file size for logging
     */
    async function getFileSize(uri: vscode.Uri): Promise<number> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return stat.size;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Create backup file
     */
    async function createBackup(uri: vscode.Uri): Promise<boolean> {
        try {
            const originalContent = await vscode.workspace.fs.readFile(uri);
            let backupPath = uri.fsPath + '.bak';
            let backupUri = vscode.Uri.file(backupPath);
            
            // Check if backup already exists and create unique name if needed
            let counter = 1;
            while (true) {
                try {
                    await vscode.workspace.fs.stat(backupUri);
                    // Backup exists, try with number suffix
                    backupPath = uri.fsPath + `.bak.${counter}`;
                    backupUri = vscode.Uri.file(backupPath);
                    counter++;
                    if (counter > 100) {
                        throw new Error('Too many backup files exist');
                    }
                } catch (statError) {
                    // Backup doesn't exist, we can use this name
                    break;
                }
            }
            
            await vscode.workspace.fs.writeFile(backupUri, originalContent);
            log(`Backup created: ${backupPath}`);
            return true;
        } catch (error) {
            log(`Failed to create backup: ${error}`, 'error');
            return false;
        }
    }

    /**
     * Reopen file with new encoding
     */
    async function reopenFileWithNewEncoding(uri: vscode.Uri): Promise<void> {
        try {
            // Find if the file is currently open in any editor
            const openEditors = vscode.window.tabGroups.all.flatMap(group => 
                group.tabs.filter(tab => 
                    tab.input instanceof vscode.TabInputText && 
                    tab.input.uri.toString() === uri.toString()
                )
            );
            
            if (openEditors.length > 0) {
                // Close all tabs with this file
                await vscode.window.tabGroups.close(openEditors);
                
                // Wait a bit for the file to be closed
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Reopen the file - VS Code will auto-detect the new encoding
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            
            log(`File reopened with new encoding: ${path.basename(uri.fsPath)}`);
        } catch (error) {
            log(`Failed to reopen file: ${error}`, 'warn');
            // Don't throw error, just log it as this is not critical
        }
    }

    /**
     * Normalize encoding name to standard format
     */
    function normalizeEncoding(encoding: string): string {
        const normalized = encoding.toLowerCase().trim();
        
        // Handle common variations
        const encodingMap: { [key: string]: string } = {
            'utf8': 'utf-8',
            'utf16': 'utf-16',
            'utf16le': 'utf-16le',
            'utf16be': 'utf-16be',
            'ascii': 'ascii',
            'latin1': 'iso-8859-1',
            'cp1252': 'windows-1252',
            'gb18030': 'gb18030'
        };
        
        return encodingMap[normalized] || normalized;
    }

    /**
     * Detect file encoding with multiple methods
     */
    async function detectEncoding(uri: vscode.Uri): Promise<{ encoding: string; confidence: number; method: string }> {
        try {
            const raw = await vscode.workspace.fs.readFile(uri);
            const rawBuffer = Buffer.from(raw);
            
            // Handle empty files
            if (rawBuffer.length === 0) {
                return { encoding: 'utf-8', confidence: 1.0, method: 'empty-file' };
            }
            
            // Handle very small files (less than 4 bytes)
            if (rawBuffer.length < 4) {
                // Check if it's pure ASCII
                const isAscii = rawBuffer.every(byte => byte < 128 && byte > 0);
                if (isAscii) {
                    return { encoding: 'ascii', confidence: 0.9, method: 'small-ascii' };
                }
                return { encoding: 'utf-8', confidence: 0.7, method: 'small-file' };
            }
            
            // Method 1: VS Code's encoding detection
            const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
            if (openDocument) {
                const vscodeEncoding = (openDocument as any).encoding || (openDocument as any)._encoding;
                if (vscodeEncoding && vscodeEncoding !== 'utf8' && vscodeEncoding !== 'utf-8') {
                    return { encoding: normalizeEncoding(vscodeEncoding), confidence: 0.95, method: 'vscode' };
                }
            }
            
            // Method 2: jschardet
            try {
                const result = jschardet.detect(rawBuffer);
                if (result && result.encoding && result.confidence > 0.7) {
                    return { encoding: normalizeEncoding(result.encoding), confidence: result.confidence, method: 'jschardet' };
                }
            } catch (error) {
                log(`jschardet failed: ${error}`, 'warn');
            }
            
            // Method 3: detect-file-encoding-and-language
            try {
                const info = await detectFile(rawBuffer);
                if (info.encoding && info.encoding.toLowerCase() !== 'utf-8') {
                    return { encoding: normalizeEncoding(info.encoding), confidence: 0.8, method: 'detect-file-encoding-and-language' };
                }
            } catch (error) {
                log(`detect-file-encoding-and-language failed: ${error}`, 'warn');
            }
            
            // Method 4: Heuristic detection
            const commonEncodings = ['big5', 'gbk', 'gb2312', 'shift_jis', 'euc-kr', 'iso-8859-1', 'windows-1252'];
            for (const testEncoding of commonEncodings) {
                try {
                    const testText = iconv.decode(rawBuffer, testEncoding);
                    const replacementCount = (testText.match(/\ufffd/g) || []).length;
                    
                    // Dynamic threshold based on file size
                    const threshold = rawBuffer.length < 100 ? 
                        Math.max(1, Math.floor(rawBuffer.length * 0.1)) : // 10% for very small files, minimum 1
                        Math.floor(rawBuffer.length * 0.05); // 5% for larger files
                    
                    if (replacementCount < threshold) {
                        return { encoding: normalizeEncoding(testEncoding), confidence: 0.6, method: 'heuristic' };
                    }
                } catch (error) {
                    // Continue to next encoding
                }
            }
            
            // Default to UTF-8
            return { encoding: 'utf-8', confidence: 0.5, method: 'default' };
        } catch (error) {
            log(`Encoding detection failed: ${error}`, 'error');
            return { encoding: 'utf-8', confidence: 0.1, method: 'fallback' };
        }
    }

    /**
     * Convert file with comprehensive error handling
     */
    async function convertFile(uri: vscode.Uri, sourceEncoding?: string, targetEncoding: string = 'utf8'): Promise<ConversionResult> {
        const config = getConfig();
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);
        
        log(`Starting conversion: ${fileName}`);
        
        // Check if file should be processed
        const processCheck = shouldProcessFile(uri, config);
        if (!processCheck.shouldProcess) {
            return {
                success: false,
                filePath,
                skipped: true,
                skipReason: processCheck.reason
            };
        }
        
        // Get file size for logging
        const fileSize = await getFileSize(uri);
        
        try {
            // Read file content
            const raw = await vscode.workspace.fs.readFile(uri);
            const rawBuffer = Buffer.from(raw);
            
            // Check for extremely large files (>50MB) and warn
            if (rawBuffer.length > 50 * 1024 * 1024) {
                const sizeMB = (rawBuffer.length / (1024 * 1024)).toFixed(1);
                log(`Warning: Processing very large file (${sizeMB}MB): ${fileName}`, 'warn');
                
                // Ask for confirmation for files over 100MB
                if (rawBuffer.length > 100 * 1024 * 1024) {
                    const proceed = await vscode.window.showWarningMessage(
                        `The file "${fileName}" is very large (${sizeMB}MB). Processing it may consume significant memory. Continue?`,
                        'Yes', 'No'
                    );
                    if (proceed !== 'Yes') {
                        return {
                            success: false,
                            filePath,
                            skipped: true,
                            skipReason: 'User cancelled due to large file size'
                        };
                    }
                }
            }
            
            // Detect or use provided encoding
            let detectedEncoding: string;
            let confidence: number;
            let method: string;
            
            if (sourceEncoding) {
                detectedEncoding = sourceEncoding.toLowerCase();
                confidence = 1.0;
                method = 'manual';
            } else {
                const detection = await detectEncoding(uri);
                detectedEncoding = detection.encoding;
                confidence = detection.confidence;
                method = detection.method;
            }
            
            log(`Detected encoding: ${detectedEncoding} (confidence: ${confidence}, method: ${method})`);
            
            // Check if already in target encoding
            const normalizedDetected = normalizeEncoding(detectedEncoding);
            const normalizedTarget = normalizeEncoding(targetEncoding);
            
            if (normalizedDetected === normalizedTarget) {
                // Double-check by trying to decode
                try {
                    const testText = iconv.decode(rawBuffer, normalizedTarget);
                    const reencoded = iconv.encode(testText, normalizedTarget);
                    if (Buffer.compare(rawBuffer, reencoded) === 0) {
                        return {
                            success: true,
                            filePath,
                            originalEncoding: detectedEncoding,
                            targetEncoding,
                            fileSize: fileSize,
                            skipped: true,
                            skipReason: 'Already in target encoding'
                        };
                    }
                } catch (error) {
                    log(`Target encoding verification failed: ${error}`, 'warn');
                }
            }
            
            // Create backup if enabled
            let backupCreated = false;
            if (config.createBackup) {
                backupCreated = await createBackup(uri);
            }
            
            // Decode from source encoding
            let text: string;
            try {
                text = iconv.decode(rawBuffer, detectedEncoding);
            } catch (error) {
                log(`Decode failed with ${detectedEncoding}, trying with error handling: ${error}`, 'warn');
                try {
                    text = iconv.decode(rawBuffer, detectedEncoding, { stripBOM: true });
                } catch (fallbackError) {
                    throw new Error(`Failed to decode file: ${fallbackError}`);
                }
            }
            
            // Encode to target encoding
            let encodedBuffer: Buffer;
            try {
                encodedBuffer = iconv.encode(text, targetEncoding);
            } catch (error) {
                throw new Error(`Failed to encode to ${targetEncoding}: ${error}`);
            }
            
            // Write converted content
            await vscode.workspace.fs.writeFile(uri, encodedBuffer);
            
            log(`Successfully converted ${fileName} from ${detectedEncoding} to ${targetEncoding}`);
            
            return {
                success: true,
                filePath,
                originalEncoding: detectedEncoding,
                targetEncoding,
                fileSize: fileSize,
                backupCreated,
                detectedOriginalEncoding: detectedEncoding
            };
            
        } catch (error) {
            const errorMessage = `Conversion failed: ${error}`;
            log(errorMessage, 'error');
            
            return {
                success: false,
                filePath,
                originalEncoding: sourceEncoding,
                targetEncoding,
                fileSize: fileSize,
                error: errorMessage
            };
        }
    }

    /**
     * Get all files in directory recursively
     */
    async function getFilesInDirectory(uri: vscode.Uri): Promise<vscode.Uri[]> {
        const files: vscode.Uri[] = [];
        const config = getConfig();
        
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            
            for (const [name, type] of entries) {
                const childUri = vscode.Uri.joinPath(uri, name);
                
                if (type === vscode.FileType.File) {
                    const processCheck = shouldProcessFile(childUri, config);
                    if (processCheck.shouldProcess) {
                        files.push(childUri);
                    }
                } else if (type === vscode.FileType.Directory) {
                    // Recursively get files from subdirectory
                    const subFiles = await getFilesInDirectory(childUri);
                    files.push(...subFiles);
                }
            }
        } catch (error) {
            log(`Error reading directory ${uri.fsPath}: ${error}`, 'error');
        }
        
        return files;
    }

    /**
     * Show pre-conversion confirmation dialog
     */
    async function showPreConversionDialog(files: vscode.Uri[], operation: string): Promise<boolean> {
        const config = getConfig();
        const maxDisplay = 10;
        
        const fileList = files.slice(0, maxDisplay).map(f => path.basename(f.fsPath)).join('\n');
        const moreFiles = files.length > maxDisplay ? `\n... and ${files.length - maxDisplay} more files` : '';
        
        const message = `${operation}\n\nFiles to process (${files.length}):\n${fileList}${moreFiles}\n\nSettings:\n- Create backup: ${config.createBackup ? 'Yes' : 'No'}\n- Concurrent files: ${config.batchConcurrency}\n- Auto-reopen files: ${config.autoReopenFiles ? 'Yes' : 'No'} (single file conversion only)`;
        
        const result = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            'Continue',
            'Cancel'
        );
        
        return result === 'Continue';
    }

    /**
     * Find the most recent backup file
     */
    async function findLatestBackup(filePath: string): Promise<string | null> {
        const candidates = [
            filePath + '.bak',
            filePath + '.bak.1',
            filePath + '.bak.2',
            filePath + '.bak.3',
            filePath + '.bak.4',
            filePath + '.bak.5'
        ];
        
        // Find the most recent backup by checking modification time
        let latestBackup: string | null = null;
        let latestTime = 0;
        
        for (const candidate of candidates) {
            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
                if (stat.mtime > latestTime) {
                    latestTime = stat.mtime;
                    latestBackup = candidate;
                }
            } catch (error) {
                // File doesn't exist, continue
            }
        }
        
        return latestBackup;
    }

    /**
     * Undo conversion by restoring from backup
     */
    async function undoConversion(filePath: string, originalEncoding?: string, reopenFile: boolean = false): Promise<boolean> {
        try {
            const backupPath = await findLatestBackup(filePath);
            if (!backupPath) {
                vscode.window.showErrorMessage(`No backup file found for: ${path.basename(filePath)}`);
                return false;
            }
            
            const backupUri = vscode.Uri.file(backupPath);
            const originalUri = vscode.Uri.file(filePath);
            
            // Restore from backup
            const backupContent = await vscode.workspace.fs.readFile(backupUri);
            await vscode.workspace.fs.writeFile(originalUri, backupContent);
            
            // Delete backup file
            await vscode.workspace.fs.delete(backupUri);
            
            // Reopen file if requested
            if (reopenFile) {
                await reopenFileWithNewEncoding(originalUri);
            }
            
            log(`Undone conversion: ${path.basename(filePath)} (restored from ${path.basename(backupPath)})`);
            return true;
        } catch (error) {
            log(`Failed to undo conversion: ${error}`, 'error');
            vscode.window.showErrorMessage(`Failed to undo conversion: ${error}`);
            return false;
        }
    }

    /**
     * Undo batch conversion
     */
    async function undoBatchConversion(results: ConversionResult[]): Promise<void> {
        const convertedFiles = results.filter(r => r.success && !r.skipped && r.backupCreated);
        
        if (convertedFiles.length === 0) {
            vscode.window.showInformationMessage('No files to undo (no backups found)');
            return;
        }
        
        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to undo conversion for ${convertedFiles.length} files?`,
            { modal: true },
            'Yes, Undo All',
            'Cancel'
        );
        
        if (confirmed !== 'Yes, Undo All') {
            return;
        }
        
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Undoing conversions...',
            cancellable: false
        }, async (progress) => {
            let undone = 0;
            let failed = 0;
            
            for (const result of convertedFiles) {
                const success = await undoConversion(result.filePath, result.detectedOriginalEncoding);
                if (success) {
                    undone++;
                } else {
                    failed++;
                }
                
                progress.report({
                    message: `Undoing ${path.basename(result.filePath)} (${undone + failed}/${convertedFiles.length})`,
                    increment: (1 / convertedFiles.length) * 100
                });
            }
            
            const summary = `Undo completed. Restored: ${undone}, Failed: ${failed}`;
            if (failed > 0) {
                vscode.window.showWarningMessage(summary);
            } else {
                vscode.window.showInformationMessage(summary);
            }
        });
    }

    /**
     * Show detailed conversion results
     */
    function showConversionResults(result: BatchConversionResult, operation: string) {
        const config = getConfig();
        
        if (!config.showDetailedResults) {
            // Simple summary
            const summary = `${operation} completed. Processed: ${result.processed}, Converted: ${result.converted}, Skipped: ${result.skipped}, Errors: ${result.errors}`;
            if (result.errors > 0) {
                vscode.window.showWarningMessage(summary, 'Undo', 'OK').then(selection => {
                    if (selection === 'Undo') {
                        undoBatchConversion(result.results);
                    }
                });
            } else {
                vscode.window.showInformationMessage(summary, 'Undo', 'OK').then(selection => {
                    if (selection === 'Undo') {
                        undoBatchConversion(result.results);
                    }
                });
            }
            return;
        }
        
        // Detailed results
        const successful = result.results.filter(r => r.success && !r.skipped);
        const skipped = result.results.filter(r => r.skipped);
        const failed = result.results.filter(r => !r.success && !r.skipped);
        
        let message = `${operation} Results:\n\n`;
        message += `Summary:\n`;
        message += `- Total files: ${result.totalFiles}\n`;
        message += `- Processed: ${result.processed}\n`;
        message += `- Converted: ${result.converted}\n`;
        message += `- Skipped: ${result.skipped}\n`;
        message += `- Errors: ${result.errors}\n\n`;
        
        if (successful.length > 0) {
            message += `Successfully converted (${successful.length}):\n`;
            successful.slice(0, 5).forEach(r => {
                message += `- ${path.basename(r.filePath)}: ${r.originalEncoding} -> ${r.targetEncoding}\n`;
            });
            if (successful.length > 5) {
                message += `... and ${successful.length - 5} more\n`;
            }
            message += '\n';
        }
        
        if (skipped.length > 0) {
            message += `Skipped files (${skipped.length}):\n`;
            skipped.slice(0, 5).forEach(r => {
                message += `- ${path.basename(r.filePath)}: ${r.skipReason}\n`;
            });
            if (skipped.length > 5) {
                message += `... and ${skipped.length - 5} more\n`;
            }
            message += '\n';
        }
        
        if (failed.length > 0) {
            message += `Failed files (${failed.length}):\n`;
            failed.slice(0, 5).forEach(r => {
                message += `- ${path.basename(r.filePath)}: ${r.error}\n`;
            });
            if (failed.length > 5) {
                message += `... and ${failed.length - 5} more\n`;
            }
        }
        
        // Show results in modal dialog with undo option
        if (result.errors > 0) {
            vscode.window.showWarningMessage(message, { modal: true }, 'Undo', 'OK').then(selection => {
                if (selection === 'Undo') {
                    undoBatchConversion(result.results);
                }
            });
        } else {
            vscode.window.showInformationMessage(message, { modal: true }, 'Undo', 'OK').then(selection => {
                if (selection === 'Undo') {
                    undoBatchConversion(result.results);
                }
            });
        }
    }

    /**
     * Process multiple files with concurrency control
     */
    async function processMultipleFiles(
        files: vscode.Uri[],
        sourceEncoding: string | undefined,
        targetEncoding: string,
        operation: string
    ): Promise<BatchConversionResult> {
        const config = getConfig();
        const totalFiles = files.length;
        
        // Show confirmation dialog
        const confirmed = await showPreConversionDialog(files, operation);
        if (!confirmed) {
            return {
                totalFiles: 0,
                processed: 0,
                converted: 0,
                skipped: 0,
                errors: 0,
                results: []
            };
        }
        
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: operation,
            cancellable: true
        }, async (progress, token) => {
            const results: ConversionResult[] = [];
            const batchSize = Math.min(config.batchConcurrency, totalFiles);
            let processed = 0;
            let converted = 0;
            let skipped = 0;
            let errors = 0;
            
            // Process files in batches
            for (let i = 0; i < totalFiles; i += batchSize) {
                if (token.isCancellationRequested) {
                    log('Operation cancelled by user', 'warn');
                    break;
                }
                
                const batch = files.slice(i, i + batchSize);
                const batchPromises = batch.map(file => convertFile(file, sourceEncoding, targetEncoding));
                
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
                
                // Update statistics
                for (const result of batchResults) {
                    processed++;
                    if (result.success) {
                        if (result.skipped) {
                            skipped++;
                        } else {
                            converted++;
                        }
                    } else {
                        if (result.skipped) {
                            skipped++;
                        } else {
                            errors++;
                        }
                    }
                }
                
                // Update progress
                const progressPercent = (processed / totalFiles) * 100;
                const currentFile = batchResults[batchResults.length - 1];
                progress.report({
                    message: `Processing ${path.basename(currentFile.filePath)} (${processed}/${totalFiles})`,
                    increment: (batchSize / totalFiles) * 100
                });
            }
            
            return {
                totalFiles,
                processed,
                converted,
                skipped,
                errors,
                results
            };
        });
    }

    // Register Convert to UTF-8 command (auto-detect)
    const convertToUTF8 = vscode.commands.registerCommand(
        'extension.convertToUTF8',
        async (uri?: vscode.Uri) => {
            log('Convert to UTF-8 command triggered');
            
            try {
                let targetUri: vscode.Uri;
                
                if (uri) {
                    targetUri = uri;
                } else {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showErrorMessage('No file is currently open');
                        return;
                    }
                    targetUri = editor.document.uri;
                }
                
                const result = await convertFile(targetUri, undefined, 'utf8');
                
                if (result.success) {
                    if (result.skipped) {
                        vscode.window.showInformationMessage(
                            `File ${result.skipReason?.toLowerCase()}: ${path.basename(result.filePath)}`
                        );
                    } else {
                        // First, reopen file with new encoding if enabled
                        const config = getConfig();
                        if (config.autoReopenFiles) {
                            await reopenFileWithNewEncoding(targetUri);
                        }
                        
                        // Then show success message with undo option
                        const message = `File converted to UTF-8: ${path.basename(result.filePath)}`;
                        
                        if (result.backupCreated) {
                            vscode.window.showInformationMessage(message, 'Undo').then(selection => {
                                if (selection === 'Undo') {
                                    undoConversion(result.filePath, result.detectedOriginalEncoding, config.autoReopenFiles).then(success => {
                                        if (success) {
                                            vscode.window.showInformationMessage(
                                                `Conversion undone: ${path.basename(result.filePath)}`
                                            );
                                        }
                                    });
                                }
                            });
                        } else {
                            vscode.window.showInformationMessage(message);
                        }
                    }
                } else {
                    if (result.skipped) {
                        vscode.window.showWarningMessage(
                            `File skipped (${result.skipReason}): ${path.basename(result.filePath)}`
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            `Conversion failed: ${result.error}`
                        );
                    }
                }
            } catch (error) {
                log(`Command failed: ${error}`, 'error');
                vscode.window.showErrorMessage(`Conversion failed: ${error}`);
            }
        }
    );

    // Register Convert between encodings command
    const convertBetweenEncodings = vscode.commands.registerCommand(
        'extension.convertBetweenEncodings',
        async (uri?: vscode.Uri) => {
            log('Convert between encodings command triggered');
            
            try {
                let targetUri: vscode.Uri;
                
                if (uri) {
                    targetUri = uri;
                } else {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showErrorMessage('No file is currently open');
                        return;
                    }
                    targetUri = editor.document.uri;
                }
                
                const encodingOptions = [
                    { label: 'UTF-8', description: 'Unicode UTF-8' },
                    { label: 'Big5', description: 'Traditional Chinese' },
                    { label: 'GBK', description: 'Simplified Chinese' },
                    { label: 'GB2312', description: 'Simplified Chinese (older)' },
                    { label: 'Shift_JIS', description: 'Japanese' },
                    { label: 'EUC-KR', description: 'Korean' },
                    { label: 'ISO-8859-1', description: 'Western European' },
                    { label: 'Windows-1252', description: 'Windows Western European' },
                    { label: 'UTF-16', description: 'Unicode UTF-16' },
                    { label: 'UTF-16BE', description: 'Unicode UTF-16 Big Endian' },
                    { label: 'UTF-16LE', description: 'Unicode UTF-16 Little Endian' }
                ];
                
                // Auto-detect current encoding for preview
                const detection = await detectEncoding(targetUri);
                const detectedText = `Auto-detected: ${detection.encoding.toUpperCase()} (${(detection.confidence * 100).toFixed(1)}% confidence)`;
                
                // Select source encoding
                const sourceEncoding = await vscode.window.showQuickPick([
                    { label: 'Auto-detect', description: detectedText },
                    ...encodingOptions
                ], {
                    placeHolder: 'Select the source encoding of the file',
                    ignoreFocusOut: true
                });
                
                if (!sourceEncoding) {
                    return;
                }
                
                // Select target encoding
                const targetEncoding = await vscode.window.showQuickPick(encodingOptions, {
                    placeHolder: 'Select the target encoding for the file',
                    ignoreFocusOut: true
                });
                
                if (!targetEncoding) {
                    return;
                }
                
                const sourceEncodingValue = sourceEncoding.label === 'Auto-detect' ? undefined : sourceEncoding.label;
                
                if (sourceEncodingValue === targetEncoding.label) {
                    vscode.window.showWarningMessage('Source and target encodings are the same');
                    return;
                }
                
                const result = await convertFile(targetUri, sourceEncodingValue, targetEncoding.label.toLowerCase());
                
                if (result.success) {
                    if (result.skipped) {
                        vscode.window.showInformationMessage(
                            `File ${result.skipReason?.toLowerCase()}: ${path.basename(result.filePath)}`
                        );
                    } else {
                        // First, reopen file with new encoding if enabled
                        const config = getConfig();
                        if (config.autoReopenFiles) {
                            await reopenFileWithNewEncoding(targetUri);
                        }
                        
                        // Then show success message with undo option
                        const message = `File converted from ${result.originalEncoding?.toUpperCase()} to ${targetEncoding.label}: ${path.basename(result.filePath)}`;
                        
                        if (result.backupCreated) {
                            vscode.window.showInformationMessage(message, 'Undo').then(selection => {
                                if (selection === 'Undo') {
                                    undoConversion(result.filePath, result.detectedOriginalEncoding, config.autoReopenFiles).then(success => {
                                        if (success) {
                                            vscode.window.showInformationMessage(
                                                `Conversion undone: ${path.basename(result.filePath)}`
                                            );
                                        }
                                    });
                                }
                            });
                        } else {
                            vscode.window.showInformationMessage(message);
                        }
                    }
                } else {
                    if (result.skipped) {
                        vscode.window.showWarningMessage(
                            `File skipped (${result.skipReason}): ${path.basename(result.filePath)}`
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            `Conversion failed: ${result.error}`
                        );
                    }
                }
            } catch (error) {
                log(`Command failed: ${error}`, 'error');
                vscode.window.showErrorMessage(`Conversion failed: ${error}`);
            }
        }
    );

    // Register Batch Convert to UTF-8 command
    const batchConvertToUTF8 = vscode.commands.registerCommand(
        'extension.batchConvertToUTF8',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            log('Batch convert to UTF-8 command triggered');
            
            try {
                let filesToProcess: vscode.Uri[] = [];
                
                if (uris && uris.length > 0) {
                    // Multiple files selected
                    for (const fileUri of uris) {
                        const stat = await vscode.workspace.fs.stat(fileUri);
                        if (stat.type === vscode.FileType.File) {
                            filesToProcess.push(fileUri);
                        } else if (stat.type === vscode.FileType.Directory) {
                            const dirFiles = await getFilesInDirectory(fileUri);
                            filesToProcess.push(...dirFiles);
                        }
                    }
                } else if (uri) {
                    // Single file or directory
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.type === vscode.FileType.File) {
                        filesToProcess.push(uri);
                    } else if (stat.type === vscode.FileType.Directory) {
                        filesToProcess = await getFilesInDirectory(uri);
                    }
                }
                
                if (filesToProcess.length === 0) {
                    vscode.window.showInformationMessage('No files to process');
                    return;
                }
                
                const result = await processMultipleFiles(
                    filesToProcess,
                    undefined,
                    'utf8',
                    'Batch Convert to UTF-8'
                );
                
                showConversionResults(result, 'Batch Convert to UTF-8');
                
            } catch (error) {
                log(`Batch conversion failed: ${error}`, 'error');
                vscode.window.showErrorMessage(`Batch conversion failed: ${error}`);
            }
        }
    );

    // Register Batch Convert between encodings command
    const batchConvertBetweenEncodings = vscode.commands.registerCommand(
        'extension.batchConvertBetweenEncodings',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            log('Batch convert between encodings command triggered');
            
            try {
                let filesToProcess: vscode.Uri[] = [];
                
                if (uris && uris.length > 0) {
                    // Multiple files selected
                    for (const fileUri of uris) {
                        const stat = await vscode.workspace.fs.stat(fileUri);
                        if (stat.type === vscode.FileType.File) {
                            filesToProcess.push(fileUri);
                        } else if (stat.type === vscode.FileType.Directory) {
                            const dirFiles = await getFilesInDirectory(fileUri);
                            filesToProcess.push(...dirFiles);
                        }
                    }
                } else if (uri) {
                    // Single file or directory
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.type === vscode.FileType.File) {
                        filesToProcess.push(uri);
                    } else if (stat.type === vscode.FileType.Directory) {
                        filesToProcess = await getFilesInDirectory(uri);
                    }
                }
                
                if (filesToProcess.length === 0) {
                    vscode.window.showInformationMessage('No files to process');
                    return;
                }
                
                const encodingOptions = [
                    { label: 'UTF-8', description: 'Unicode UTF-8' },
                    { label: 'Big5', description: 'Traditional Chinese' },
                    { label: 'GBK', description: 'Simplified Chinese' },
                    { label: 'GB2312', description: 'Simplified Chinese (older)' },
                    { label: 'Shift_JIS', description: 'Japanese' },
                    { label: 'EUC-KR', description: 'Korean' },
                    { label: 'ISO-8859-1', description: 'Western European' },
                    { label: 'Windows-1252', description: 'Windows Western European' },
                    { label: 'UTF-16', description: 'Unicode UTF-16' },
                    { label: 'UTF-16BE', description: 'Unicode UTF-16 Big Endian' },
                    { label: 'UTF-16LE', description: 'Unicode UTF-16 Little Endian' }
                ];
                
                // Select source encoding
                const sourceEncoding = await vscode.window.showQuickPick([
                    { label: 'Auto-detect', description: 'Automatically detect encoding for each file' },
                    ...encodingOptions
                ], {
                    placeHolder: 'Select the source encoding of the files',
                    ignoreFocusOut: true
                });
                
                if (!sourceEncoding) {
                    return;
                }
                
                // Select target encoding
                const targetEncoding = await vscode.window.showQuickPick(encodingOptions, {
                    placeHolder: 'Select the target encoding for the files',
                    ignoreFocusOut: true
                });
                
                if (!targetEncoding) {
                    return;
                }
                
                const sourceEncodingValue = sourceEncoding.label === 'Auto-detect' ? undefined : sourceEncoding.label;
                
                if (sourceEncodingValue === targetEncoding.label) {
                    vscode.window.showWarningMessage('Source and target encodings are the same');
                    return;
                }
                
                const result = await processMultipleFiles(
                    filesToProcess,
                    sourceEncodingValue,
                    targetEncoding.label.toLowerCase(),
                    `Batch Convert from ${sourceEncoding.label} to ${targetEncoding.label}`
                );
                
                showConversionResults(result, `Batch Convert to ${targetEncoding.label}`);
                
            } catch (error) {
                log(`Batch conversion failed: ${error}`, 'error');
                vscode.window.showErrorMessage(`Batch conversion failed: ${error}`);
            }
        }
    );

    // Register all commands
    context.subscriptions.push(
        convertToUTF8,
        convertBetweenEncodings,
        batchConvertToUTF8,
        batchConvertBetweenEncodings
    );

    log('All commands registered successfully');
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.dispose();
    }
} 