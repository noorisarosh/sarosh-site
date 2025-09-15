import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import csv from 'csv-parser';
import { parse as parseHtml } from 'node-html-parser';
import { marked } from 'marked';
import iconv from 'iconv-lite';
import mime from 'mime-types';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

// Helper function to detect file encoding
function detectEncoding(buffer) {
  // Simple encoding detection
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf8'; // UTF-8 BOM
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return 'utf16le'; // UTF-16 LE BOM
  }
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return 'utf16be'; // UTF-16 BE BOM
  }
  return 'utf8'; // Default to UTF-8
}

// Process different file types
async function processFile(filePath, fileName, mimeType) {
  const fileExtension = path.extname(fileName).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);
  
  try {
    switch (fileExtension) {
      case '.pdf':
        const pdfData = await pdf(fileBuffer);
        return {
          content: pdfData.text,
          type: 'PDF Document',
          pages: pdfData.numpages
        };

      case '.docx':
      case '.doc':
        const docResult = await mammoth.extractRawText({ buffer: fileBuffer });
        return {
          content: docResult.value,
          type: 'Word Document',
          warnings: docResult.messages
        };

      case '.xlsx':
      case '.xls':
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        let excelContent = '';
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const sheetData = XLSX.utils.sheet_to_csv(sheet);
          excelContent += `Sheet: ${sheetName}\n${sheetData}\n\n`;
        });
        return {
          content: excelContent,
          type: 'Excel Spreadsheet',
          sheets: workbook.SheetNames.length
        };

      case '.csv':
        const encoding = detectEncoding(fileBuffer);
        const csvContent = iconv.decode(fileBuffer, encoding);
        return {
          content: csvContent,
          type: 'CSV File'
        };

      case '.html':
      case '.htm':
        const encoding2 = detectEncoding(fileBuffer);
        const htmlContent = iconv.decode(fileBuffer, encoding2);
        const root = parseHtml(htmlContent);
        const textContent = root.text;
        return {
          content: textContent,
          type: 'HTML Document'
        };

      case '.md':
        const encoding3 = detectEncoding(fileBuffer);
        const markdownContent = iconv.decode(fileBuffer, encoding3);
        const htmlFromMd = marked(markdownContent);
        const mdRoot = parseHtml(htmlFromMd);
        return {
          content: `${markdownContent}\n\n--- Rendered as: ---\n${mdRoot.text}`,
          type: 'Markdown Document'
        };

      case '.txt':
      case '.rtf':
      case '':
        const encoding4 = detectEncoding(fileBuffer);
        const textFileContent = iconv.decode(fileBuffer, encoding4);
        return {
          content: textFileContent,
          type: 'Text Document'
        };

      case '.json':
        const encoding5 = detectEncoding(fileBuffer);
        const jsonContent = iconv.decode(fileBuffer, encoding5);
        try {
          const jsonObj = JSON.parse(jsonContent);
          return {
            content: `JSON Structure:\n${JSON.stringify(jsonObj, null, 2)}`,
            type: 'JSON File'
          };
        } catch (e) {
          return {
            content: jsonContent,
            type: 'JSON File (Invalid format, showing raw content)'
          };
        }

      case '.xml':
        const encoding6 = detectEncoding(fileBuffer);
        const xmlContent = iconv.decode(fileBuffer, encoding6);
        const xmlRoot = parseHtml(xmlContent);
        return {
          content: `XML Content:\n${xmlContent}\n\n--- Text Content: ---\n${xmlRoot.text}`,
          type: 'XML Document'
        };

      default:
        // Try to read as text for unknown extensions
        try {
          const encoding7 = detectEncoding(fileBuffer);
          const unknownContent = iconv.decode(fileBuffer, encoding7);
          return {
            content: unknownContent,
            type: `Unknown File Type (${fileExtension || 'no extension'})`
          };
        } catch (error) {
          throw new Error(`Unsupported file type: ${fileExtension}`);
        }
    }
  } catch (error) {
    console.error(`Error processing ${fileExtension} file:`, error);
    throw new Error(`Failed to process ${fileExtension} file: ${error.message}`);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const form = formidable({
      maxFileSize: 25 * 1024 * 1024, // 25MB limit
      keepExtensions: true,
      multiples: false,
    });

    const [fields, files] = await form.parse(req);
    
    let message = Array.isArray(fields.message) ? fields.message[0] : fields.message;
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    let fileContent = '';
    let fileInfo = '';
    
    if (uploadedFile) {
      const filePath = uploadedFile.filepath;
      const fileName = uploadedFile.originalFilename || 'unknown';
      const fileSize = (uploadedFile.size / 1024 / 1024).toFixed(2);
      const mimeType = uploadedFile.mimetype;
      
      try {
        const processedFile = await processFile(filePath, fileName, mimeType);
        fileContent = processedFile.content;
        fileInfo = `File: ${fileName} (${fileSize} MB, ${processedFile.type})`;
        
        if (processedFile.pages) {
          fileInfo += ` - ${processedFile.pages} pages`;
        }
        if (processedFile.sheets) {
          fileInfo += ` - ${processedFile.sheets} sheets`;
        }
        
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        
      } catch (fileError) {
        console.error('File processing error:', fileError);
        fileContent = `[Error processing file: ${fileName} - ${fileError.message}]`;
        fileInfo = `File: ${fileName} (${fileSize} MB, Error)`;
        
        // Still clean up the file
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
      }
    }

    // Combine message and file content
    let finalMessage = '';
    if (message && fileContent) {
      finalMessage = `User message: ${message}\n\n${fileInfo}\nFile content:\n${fileContent}`;
    } else if (message) {
      finalMessage = message;
    } else if (fileContent) {
      finalMessage = `Please analyze and summarize this file:\n${fileInfo}\n\nContent:\n${fileContent}`;
    } else {
      return res.status(400).json({ error: "Message or file is required" });
    }

    // Truncate if too long (OpenAI has token limits)
    const maxLength = 12000; // Roughly 3000-4000 tokens
    if (finalMessage.length > maxLength) {
      finalMessage = finalMessage.substring(0, maxLength) + "\n\n[Content truncated due to length...]";
    }

    const messages = [
      { 
        role: "system", 
        content: "You are an AI assistant that analyzes and summarizes documents. Provide clear, detailed summaries that capture the key points, structure, and important information. If the content is too short to summarize meaningfully, explain what the document contains instead. For data files (CSV, Excel), highlight key patterns or insights. For code files, explain functionality." 
      },
      { role: "user", content: finalMessage }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages,
        
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    res.status(200).json({
      reply: data.choices?.[0]?.message?.content || "No reply generated",
      fileInfo: fileInfo || null,
    });

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ 
      error: "Processing failed", 
      details: err.message 
    });
  }
}
