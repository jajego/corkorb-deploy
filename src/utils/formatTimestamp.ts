/**
 * Formats a timestamp string to the user's local timezone.
 * 
 * Handles timestamps from:
 * - Optimistic papers: ISO 8601 with 'Z' suffix (UTC) from `new Date().toISOString()`
 * - Server responses: ISO 8601 with or without timezone info from Pydantic/FastAPI
 * 
 * IMPORTANT: Backend stores all timestamps in UTC (timezone-aware), but FastAPI/Pydantic
 * may serialize them without timezone info. JavaScript Date.parse() treats timestamps
 * without timezone as LOCAL time, which causes incorrect display. We ensure all
 * timestamps are parsed as UTC, then converted to user's local timezone.
 * 
 * @param timestamp - ISO 8601 timestamp string (e.g., "2024-01-01T17:15:00.000Z" or "2024-01-01T17:15:00")
 * @returns Formatted timestamp in user's local timezone, or null if invalid
 */
export function formatTimestamp(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  
  try {
    let normalizedTimestamp = timestamp.trim()
    
    // Check if timestamp has explicit timezone indicator at the END
    // Look for patterns that indicate timezone:
    // - 'Z' at the very end (UTC)
    // - Timezone offset like '+00:00', '+0000', '-05:00', '-0500' at the end
    // We check the end specifically to avoid matching date separators like "2024-01-01"
    const endsWithZ = normalizedTimestamp.endsWith('Z')
    const hasTimezoneOffset = /[+-]\d{2}:?\d{2}$/.test(normalizedTimestamp)
    const hasExplicitTimezone = endsWithZ || hasTimezoneOffset
    
    // If no explicit timezone, assume UTC (backend stores UTC)
    // Append 'Z' to force UTC parsing: "2024-01-01T17:15:00" -> "2024-01-01T17:15:00Z"
    // This handles legacy data or edge cases where timezone info might be missing
    if (!hasExplicitTimezone) {
      normalizedTimestamp = `${normalizedTimestamp}Z`
    }
    
    // Parse as UTC (if we added 'Z') or with timezone (if it had one)
    const date = new Date(normalizedTimestamp)
    
    // Validate the date
    if (isNaN(date.getTime())) {
      console.warn(`Invalid timestamp (after normalization): ${normalizedTimestamp} (original: ${timestamp})`)
      return null
    }
    
    // Format to local time using user's locale
    return date.toLocaleString()
  } catch (error) {
    console.warn(`Error formatting timestamp: ${timestamp}`, error)
    return null
  }
}

