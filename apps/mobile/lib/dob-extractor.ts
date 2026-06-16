// Date of Birth extraction and comparison utility

export interface DOBExtractionResult {
  dateOfBirth: string | null
  formattedDate: string | null
  age: number | null
  isOver18: boolean | null
  confidence: number
}

function formatDateWithoutTimezone(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number)
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]
  return `${monthNames[month - 1]} ${day}, ${year}`
}

export function compareDOBs(
  extractedDOB: string | null,
  userEnteredDOB: string | null,
): { match: boolean; message: string } {
  if (!extractedDOB || !userEnteredDOB) {
    return {
      match: true,
      message: "DOB comparison skipped - missing data",
    }
  }

  try {
    const extractedStr = extractedDOB.split("T")[0]
    const enteredStr = userEnteredDOB.split("T")[0]

    console.log("[DOB] Comparison - Extracted:", extractedStr, "Entered:", enteredStr)

    if (extractedStr === enteredStr) {
      return { match: true, message: "Date of birth matches" }
    }

    const [ey, em, ed] = extractedStr.split("-").map(Number)
    const [uy, um, ud] = enteredStr.split("-").map(Number)

    // Allow 1 day difference for timezone issues
    if (ey === uy && em === um && Math.abs(ed - ud) <= 1) {
      return { match: true, message: "Date of birth matches (within margin)" }
    }

    const extractedFormatted = formatDateWithoutTimezone(extractedStr)
    const enteredFormatted = formatDateWithoutTimezone(enteredStr)

    return {
      match: false,
      message: `Date of birth mismatch. ID shows ${extractedFormatted}, but you entered ${enteredFormatted}.`,
    }
  } catch (error) {
    console.log("[DOB] Comparison error:", error)
    return { match: true, message: "DOB comparison skipped - parse error" }
  }
}

// Date patterns for extraction
const datePatterns = [
  /\b(0?[1-9]|1[0-2])[/\-.\s](0?[1-9]|[12]\d|3[01])[/\-.\s](19|20)\d{2}\b/g,
  /\b(0?[1-9]|[12]\d|3[01])[/\-.\s](0?[1-9]|1[0-2])[/\-.\s](19|20)\d{2}\b/g,
  /\b(19|20)\d{2}[/\-.\s](0?[1-9]|1[0-2])[/\-.\s](0?[1-9]|[12]\d|3[01])\b/g,
  /\b(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(19|20)\d{2}\b/g,
]

const dobKeywords = ["DOB", "D.O.B", "DATE OF BIRTH", "BIRTH DATE", "BIRTHDATE", "BORN", "BD"]
const expirationKeywords = ["EXP", "EXPIRES", "EXPIRY", "EXPIRATION", "VALID", "ISS", "ISSUE", "ISSUED"]

function parseDate(dateStr: string): Date | null {
  try {
    const cleaned = dateStr.replace(/[^\d/\-.]/g, " ").trim()

    if (/^\d{8}$/.test(cleaned.replace(/\s/g, ""))) {
      const digits = cleaned.replace(/\s/g, "")
      const month = parseInt(digits.substring(0, 2)) - 1
      const day = parseInt(digits.substring(2, 4))
      const year = parseInt(digits.substring(4, 8))
      const date = new Date(year, month, day)
      if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
        return date
      }
    }

    const parts = cleaned.split(/[/\-.\s]+/).filter((p) => p.length > 0)
    if (parts.length !== 3) return null

    let year: number, month: number, day: number

    if (parts[0].length === 4) {
      year = parseInt(parts[0])
      month = parseInt(parts[1]) - 1
      day = parseInt(parts[2])
    } else if (parts[2].length === 4) {
      const first = parseInt(parts[0])
      const second = parseInt(parts[1])

      if (first > 12) {
        day = first
        month = second - 1
      } else if (second > 12) {
        month = first - 1
        day = second
      } else {
        month = first - 1
        day = second
      }
      year = parseInt(parts[2])
    } else if (parts[2].length === 2) {
      const twoDigitYear = parseInt(parts[2])
      year = twoDigitYear > 50 ? 1900 + twoDigitYear : 2000 + twoDigitYear
      month = parseInt(parts[0]) - 1
      day = parseInt(parts[1])
    } else {
      return null
    }

    const date = new Date(year, month, day)
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
      return null
    }

    return date
  } catch {
    return null
  }
}

function calculateAge(birthDate: Date): number | null {
  try {
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }

    return age
  } catch {
    return null
  }
}

function isReasonableDOB(date: Date): boolean {
  const now = new Date()
  const age = calculateAge(date)
  if (date > now) return false
  return age !== null && age >= 0 && age <= 120
}

function dateToYMD(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function extractDOBFromText(ocrText: string): DOBExtractionResult {
  console.log("[DOB] Extraction - OCR text length:", ocrText?.length || 0)

  if (!ocrText || ocrText.trim().length === 0) {
    return { dateOfBirth: null, formattedDate: null, age: null, isOver18: null, confidence: 0 }
  }

  const text = ocrText.toUpperCase()
  const foundDates: { date: Date; confidence: number; raw: string }[] = []

  // Find expiration keyword positions to avoid
  const expirationPositions: number[] = []
  for (const keyword of expirationKeywords) {
    let idx = text.indexOf(keyword)
    while (idx !== -1) {
      expirationPositions.push(idx)
      idx = text.indexOf(keyword, idx + 1)
    }
  }

  // Look for DOB-specific sections first (higher confidence)
  for (const keyword of dobKeywords) {
    const keywordIndex = text.indexOf(keyword)
    if (keywordIndex !== -1) {
      const surroundingText = text.substring(keywordIndex, Math.min(keywordIndex + 80, text.length))
      const dateMatch = surroundingText.match(/(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})/) || surroundingText.match(/(\d{8})/)

      if (dateMatch) {
        const parsedDate = parseDate(dateMatch[0])
        if (parsedDate && isReasonableDOB(parsedDate)) {
          foundDates.push({ date: parsedDate, confidence: 0.95, raw: dateMatch[0] })
        }
      }
    }
  }

  // Search for all date patterns
  for (const pattern of datePatterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const matchPosition = match.index
      const isNearExpiration = expirationPositions.some((pos) => Math.abs(matchPosition - pos) < 50)

      if (isNearExpiration) continue

      const parsedDate = parseDate(match[0])
      if (parsedDate && isReasonableDOB(parsedDate)) {
        foundDates.push({ date: parsedDate, confidence: 0.6, raw: match[0] })
      }
    }
  }

  if (foundDates.length === 0) {
    return { dateOfBirth: null, formattedDate: null, age: null, isOver18: null, confidence: 0 }
  }

  foundDates.sort((a, b) => b.confidence - a.confidence)
  const bestMatch = foundDates[0]

  const age = calculateAge(bestMatch.date)
  const isOver18 = age !== null ? age >= 18 : null
  const dateOfBirth = dateToYMD(bestMatch.date)

  return {
    dateOfBirth,
    formattedDate: formatDateWithoutTimezone(dateOfBirth),
    age,
    isOver18,
    confidence: bestMatch.confidence,
  }
}
