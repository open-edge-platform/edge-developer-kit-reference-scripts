import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const SelectLanguage = ({
  selectedLanguage,
  setSelectedLanguage,
  availableLanguages,
  disabled,
}: {
  selectedLanguage: string
  setSelectedLanguage: (language: string) => void
  availableLanguages: { id: string; name: string }[]
  disabled?: boolean
}) => {
  return (
    <Select
      value={selectedLanguage}
      onValueChange={setSelectedLanguage}
      disabled={disabled}
    >
      <SelectTrigger id="language-select">
        <SelectValue placeholder="Select language" />
      </SelectTrigger>
      <SelectContent>
        {availableLanguages.map((language) => (
          <SelectItem key={language.id} value={language.id}>
            {language.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export const SelectVoice = ({
  selectedVoice,
  setSelectedVoice,
  groupedVoices,
  disabled,
}: {
  selectedVoice: string
  setSelectedVoice: (voice: string) => void
  groupedVoices: { cached: string[]; notCached: string[] }
  disabled?: boolean
}) => {
  return (
    <Select
      value={
        groupedVoices.cached.includes(selectedVoice) ||
        groupedVoices.notCached.includes(selectedVoice)
          ? selectedVoice
          : undefined
      }
      onValueChange={setSelectedVoice}
      disabled={disabled}
    >
      <SelectTrigger id="voice-select">
        <SelectValue placeholder="Select voice" />
      </SelectTrigger>
      <SelectContent>
        {/* Cached voices section */}
        {groupedVoices.cached.length > 0 && (
          <>
            <div className="text-muted-foreground px-2 py-1.5 text-sm font-semibold">
              📦 Cached Voices (Ready)
            </div>
            {groupedVoices.cached.map((voice) => (
              <SelectItem key={voice} value={voice}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500"></span>
                  {voice}
                </div>
              </SelectItem>
            ))}
          </>
        )}

        {/* Not cached voices section */}
        {groupedVoices.notCached.length > 0 && (
          <>
            {groupedVoices.cached.length > 0 && (
              <div className="bg-border my-1 h-px"></div>
            )}
            <div className="text-muted-foreground px-2 py-1.5 text-sm font-semibold">
              ☁️ Available Voices (Will Download)
            </div>
            {groupedVoices.notCached.map((voice) => (
              <SelectItem key={voice} value={voice}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-orange-500"></span>
                  {voice}
                </div>
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  )
}
