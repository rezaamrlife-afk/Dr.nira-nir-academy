export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch(e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only HTTP and HTTPS URLs are supported' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Dr-NIRA-Academic-Reader/1.0)',
        'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,*/*'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Remote server returned ${response.status}: ${response.statusText}`
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = response.headers.get('content-disposition') || '';

    // Extract filename
    let filename = '';
    const cdMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (cdMatch) {
      filename = cdMatch[1].replace(/['"]/g, '').trim();
    }
    if (!filename) {
      const pathParts = parsedUrl.pathname.split('/');
      filename = pathParts[pathParts.length - 1] || 'document';
      if (!filename.includes('.')) {
        if (contentType.includes('pdf')) filename += '.pdf';
        else if (contentType.includes('wordprocessingml')) filename += '.docx';
        else if (contentType.includes('msword')) filename += '.doc';
        else filename += '.bin';
      }
    }

    // Validate supported types
    const supported = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    const isSupported = supported.some(t => contentType.includes(t));
    if (!isSupported) {
      return res.status(415).json({
        error: 'Unsupported document type: ' + contentType,
        hint: 'Supported formats: PDF, DOCX, DOC, TXT'
      });
    }

    // Read as buffer and convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // Size check (10MB limit)
    if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
      return res.status(413).json({
        error: 'Document exceeds 10MB limit',
        hint: 'Please download and upload the file directly'
      });
    }

    return res.status(200).json({
      contentType: contentType.split(';')[0].trim(),
      filename,
      data: base64,
      size: arrayBuffer.byteLength
    });

  } catch(err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(408).json({
        error: 'Request timed out',
        hint: 'The server took too long to respond. Try downloading and uploading the file directly.'
      });
    }
    return res.status(500).json({
      error: err.message || 'Failed to fetch document',
      hint: 'This URL may be protected or inaccessible. Try downloading and uploading manually.'
    });
  }
}
