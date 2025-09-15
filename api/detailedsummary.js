import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

// Simple file processor - starts with basic text files only
async function processFile(filePath, fileName) {
  const fileExtension = path.extname(fileName).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);
  
  console.log(`Processing file: ${fileName}, extension: ${fileExtension}, size: ${fileBuffer.length} bytes`);
  
  try {
    // Start with simple text-based files only
    switch (fileExtension) {
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
            type: `${fileExtension.toUpperCase()} File`,
            success: true
          };
        } catch (textError) {
          console.error(`Error reading as text: ${textError.message}`);
          throw new Error(`Could not read ${fileExtension} file as text`);
        }

      case '.pdf':
        // For now, return a placeholder for PDF
        return {
          content: `[PDF File: ${fileName} - PDF processing temporarily disabled for debugging. Please convert to text and try again.]`,
          type: 'PDF Document (Not processed)',
          success: false
        };

      case '.docx':
      case '.doc':
        // For now, return a placeholder for Word docs
        return {
          content: `[Word Document: ${fileName} - Word processing temporarily disabled for debugging. Please copy and paste the text content.]`,
          type: 'Word Document (Not processed)', 
          success: false
        };

      case '.xlsx':
      case '.xls':
        // For now, return a placeholder for Excel
        return {
          content: `[Excel File: ${fileName} - Excel processing temporarily disabled for debugging. Please export to CSV and try again.]`,
          type: 'Excel Spreadsheet (Not processed)',
          success: false
        };

      default:
        // Try to read as text for unknown extensions
        try {
          const content = fileBuffer.toString('utf8');
          if (content.length > 0 && content.includes('\n') || content.includes(' ')) {
            // Looks like text content
            return {
              content: content,
              type: `Unknown Text File (${fileExtension})`,
              success: true
            };
          } else {
            throw new Error('Does not appear to be a text file');
          }
        } catch (unknownError) {
          throw new Error(`Unsupported file type: ${fileExtension}. Supported types: .txt, .md, .csv, .json, .html, .xml`);
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
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      keepExtensions: true,
      multiples: false,
    });

    console.log('Parsing form data...');
    const [fields, files] = await form.parse(req);
    console.log('Form parsed successfully');
    console.log('Fields:', Object.keys(fields));
    console.log('Files:', Object.keys(files));
    
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
        fileInfo = `File: ${fileName} (${fileSize} MB, ${processedFile.type})`;
        
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
        fileContent = `[Error processing file: ${fileName} - ${fileError.message}]`;
        fileInfo = `File: ${fileName} (${fileSize} MB, Error)`;
        
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
      finalMessage = `User message: ${message}\n\n${fileInfo}\nFile content:\n${fileContent}`;
    } else if (message) {
      finalMessage = message;
    } else if (fileContent) {
      finalMessage = `Please analyze and summarize this file:\n${fileInfo}\n\nContent:\n${fileContent}`;
    } else {
      console.log('No message or file content provided');
      return res.status(400).json({ error: "Message or file is required" });
    }

    // Truncate if too long
    const maxLength = 8000; // Conservative limit
    if (finalMessage.length > maxLength) {
      finalMessage = finalMessage.substring(0, maxLength) + "\n\n[Content truncated due to length...]";
      console.log(`Message truncated from ${finalMessage.length} to ${maxLength} characters`);
    }

    console.log(`Final message length: ${finalMessage.length} characters`);

    const messages = [
      { 
        role: "system", 
        content: "You are an AI assistant that analyzes and summarizes documents. Provide clear, detailed summaries that capture the key points, structure, and important information. If the content is too short to summarize meaningfully, explain what the document contains instead." 
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
        max_tokens: 1500,
        temperature: 0.3,
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

    const reply = data.choices?.[0]?.message?.content || "No reply generated";
    
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
