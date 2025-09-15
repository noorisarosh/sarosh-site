import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '15mb',
  },
};

// Enhanced file processor with PDF support
async function processFile(filePath, fileName) {
  const fileExtension = path.extname(fileName).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);
  
  console.log(`Processing file: ${fileName}, extension: ${fileExtension}, size: ${fileBuffer.length} bytes`);
  
  try {
    switch (fileExtension) {
      case '.pdf':
        try {
          console.log('Starting PDF processing...');
          const pdfData = await pdf(fileBuffer);
          console.log(`PDF processed successfully. Pages: ${pdfData.numpages}, Text length: ${pdfData.text.length}`);
          
          if (!pdfData.text || pdfData.text.trim().length === 0) {
            throw new Error('No text content found in PDF - it might be image-based or encrypted');
          }
          
          return {
            content: pdfData.text.trim(),
            type: 'PDF Document',
            pages: pdfData.numpages,
            success: true
          };
        } catch (pdfError) {
          console.error('PDF processing error:', pdfError);
          
          // Provide helpful error messages based on the specific error
          let errorMessage = '';
          if (pdfError.message.includes('Invalid PDF')) {
            errorMessage = 'The file appears to be corrupted or not a valid PDF.';
          } else if (pdfError.message.includes('encrypted')) {
            errorMessage = 'This PDF is password-protected. Please provide an unprotected version.';
          } else if (pdfError.message.includes('No text content')) {
            errorMessage = 'This PDF contains no text (likely scanned images). Please use OCR or provide a text-based PDF.';
          } else {
            errorMessage = `PDF processing failed: ${pdfError.message}`;
          }
          
          throw new Error(errorMessage);
        }

      case '.txt':
      case '.md':
      case '.csv':
      case '.json':
      case '.html':
      case '.htm':
      case '.xml':
        try {
          const content = fileBuffer.toString('utf8');
          console.log(`Successfully read text file, content length: ${content.length}`);
          return {
            content: content,
            type: `${fileExtension.toUpperCase().replace('.', '')} File`,
            success: true
          };
        } catch (textError) {
          console.error(`Error reading as text: ${textError.message}`);
          throw new Error(`Could not read ${fileExtension} file as text`);
        }

      case '.docx':
      case '.doc':
        return {
          content: `[Word Document: ${fileName} - Word processing not yet enabled. Please export to PDF or copy/paste the text content.]`,
          type: 'Word Document (Not processed)',
          success: false
        };

      case '.xlsx':
      case '.xls':
        return {
          content: `[Excel File: ${fileName} - Excel processing not yet enabled. Please export to CSV and try again.]`,
          type: 'Excel Spreadsheet (Not processed)',
          success: false
        };

      default:
        // Try to read as text for unknown extensions
        try {
          const content = fileBuffer.toString('utf8');
          // Check if it looks like text content
          if (content.length > 0 && (content.includes('\n') || content.includes(' ') || content.length < 10000)) {
            return {
              content: content,
              type: `Unknown Text File (${fileExtension || 'no extension'})`,
              success: true
            };
          } else {
            throw new Error('Does not appear to be a text file');
          }
        } catch (unknownError) {
          throw new Error(`Unsupported file type: ${fileExtension || 'no extension'}. Supported types: .pdf, .txt, .md, .csv, .json, .html, .xml`);
        }
    }
  } catch (error) {
    console.error(`Error processing ${fileExtension} file:`, error);
    throw error;
  }
}

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  console.log('=== New request received ===');

  try {
    // Check if OpenAI API key exists
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY environment variable is missing');
      return res.status(500).json({ 
        error: "Server configuration error", 
        details: "API key not configured" 
      });
    }

    const form = formidable({
      maxFileSize: 15 * 1024 * 1024, // 15MB limit for PDFs
      keepExtensions: true,
      multiples: false,
    });

    console.log('Parsing form data...');
    const [fields, files] = await form.parse(req);
    console.log('Form parsed successfully');
    
    let message = Array.isArray(fields.message) ? fields.message[0] : fields.message;
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    console.log('Message:', message ? message.substring(0, 100) + '...' : 'None');
    console.log('File:', uploadedFile ? uploadedFile.originalFilename : 'None');

    let fileContent = '';
    let fileInfo = '';
    
    if (uploadedFile) {
      const filePath = uploadedFile.filepath;
      const fileName = uploadedFile.originalFilename || 'unknown';
      const fileSize = (uploadedFile.size / 1024 / 1024).toFixed(2);
      
      console.log(`Processing uploaded file: ${fileName}, size: ${fileSize}MB`);
      
      try {
        const processedFile = await processFile(filePath, fileName);
        fileContent = processedFile.content;
        
        // Build file info string
        fileInfo = `File: ${fileName} (${fileSize} MB, ${processedFile.type})`;
        if (processedFile.pages) {
          fileInfo += ` - ${processedFile.pages} pages`;
        }
        
        console.log(`File processed successfully. Content length: ${fileContent.length}`);
        
        // Clean up uploaded file
        try {
          fs.unlinkSync(filePath);
          console.log('Temporary file cleaned up');
        } catch (cleanupError) {
          console.error('File cleanup error:', cleanupError);
        }
        
      } catch (fileError) {
        console.error('File processing error:', fileError);
        fileContent = `[Error processing file: ${fileName}]\n\n${fileError.message}`;
        fileInfo = `File: ${fileName} (${fileSize} MB, Processing Error)`;
        
        // Still try to clean up the file
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
      finalMessage = `User request: ${message}\n\n--- File Information ---\n${fileInfo}\n\n--- File Content ---\n${fileContent}`;
    } else if (message) {
      finalMessage = message;
    } else if (fileContent) {
      finalMessage = `Please analyze and summarize this uploaded file:\n\n--- File Information ---\n${fileInfo}\n\n--- Content ---\n${fileContent}`;
    } else {
      console.log('No message or file content provided');
      return res.status(400).json({ error: "Message or file is required" });
    }

    // Truncate if too long (OpenAI token limits)
    const maxLength = 12000; // About 3000-4000 tokens
    if (finalMessage.length > maxLength) {
      console.log(`Message too long (${finalMessage.length} chars), truncating to ${maxLength}`);
      finalMessage = finalMessage.substring(0, maxLength) + "\n\n[Content truncated due to length limitations. This represents the first part of the document.]";
    }

    console.log(`Final message length: ${finalMessage.length} characters`);

    const messages = [
      { 
        role: "system", 
        content: "You are a professional document analysis assistant. When analyzing uploaded files, provide comprehensive summaries that include: 1) Document type and basic info, 2) Main topics and key points, 3) Structure and organization, 4) Important details, data, or conclusions, 5) Any notable insights. Be thorough but concise. If the document is too short to summarize, describe its contents instead." 
      },
      { role: "user", content: finalMessage }
    ];

    console.log('Sending request to OpenAI...');

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages,
        max_tokens: 2000, // Increased for better summaries
        temperature: 0.2, // Lower for more focused summaries
      }),
    });

    console.log(`OpenAI response status: ${response.status}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    console.log('OpenAI response received successfully');

    const reply = data.choices?.[0]?.message?.content || "No analysis generated";
    
    console.log(`Reply length: ${reply.length} characters`);
    console.log('=== Request completed successfully ===');

    res.status(200).json({
      reply: reply,
      fileInfo: fileInfo || null,
    });

  } catch (err) {
    console.error('=== Handler error ===');
    console.error('Error details:', err);
    console.error('Stack trace:', err.stack);
    console.error('=== End error details ===');
    
    res.status(500).json({ 
      error: "Processing failed", 
      details: err.message 
    });
  }
}
