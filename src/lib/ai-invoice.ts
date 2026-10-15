  const key = process.env.PARSEFLOW_API_KEY
  if (!key) return null
  const url = 'https://parseflow.dev/api/v1/extract'
  const formData = new FormData()
  if (image) {
    const [mime, data] = image.split(';base64,')
    const blob = await (await fetch(image)).arrayBuffer()
    formData.append('file', new Blob([blob], {type: mime || 'application/pdf'}))
  } else if (text) {
    // ParseFlow accepte aussi du texte brut (PDF/DOCX)
    formData.append('file', new Blob([text], {type: 'text/plain'}))
  }
  formData.append('document_type', 'invoice')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: formData,
  })
  if (!res.ok) return null
  const raw = await res.json()
  return mapParseFlowResult(raw)

