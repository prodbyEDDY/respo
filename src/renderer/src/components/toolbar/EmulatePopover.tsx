import { useState } from 'react'
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline'
import {
  describeEmulation,
  GEOLOCATION_PRESETS,
  geolocationPresetOf,
  LOCALE_PRESETS,
  NETWORK_LABELS,
  NETWORK_PRESETS,
  parseLatLng,
  TIMEZONE_PRESETS,
  VISION_DEFICIENCIES,
  VISION_LABELS,
  type EmulatedColorScheme,
  type EmulatedMediaType,
  type EmulationProfile,
  type GeolocationOverride,
  type NetworkPreset,
  type VisionDeficiency
} from '@shared/emulation'
import { Segmented } from '@renderer/components/common/Segmented'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { selectEmulationActive, useEmulation } from '@renderer/stores/emulation'

/** The value the location picker uses for "not one of the cities". */
const CUSTOM_LOCATION = 'custom'
/** The value every picker uses for "no override". */
const OFF = 'off'

const COLOR_SCHEMES: readonly { value: EmulatedColorScheme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const MEDIA_TYPES: readonly { value: EmulatedMediaType; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'screen', label: 'Screen' },
  { value: 'print', label: 'Print' }
]

/** One labelled row: the caption in a fixed gutter, the control filling the rest. */
function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-2">
      <span className="text-micro text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Toggle({
  id,
  label,
  checked,
  onChange
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  )
}

function formatLatLng(geo: GeolocationOverride): string {
  return `${geo.latitude}, ${geo.longitude}`
}

/**
 * The location row: a city, a custom pair of coordinates, or nothing.
 *
 * Picking a city also sets the time zone — someone "in Tokyo" expects the
 * clock to follow — and the zone row below shows that it did. Off clears the
 * position only: a zone someone chose on purpose is theirs to clear.
 */
function LocationRow({ profile }: { profile: EmulationProfile }): React.JSX.Element {
  const setProfile = useEmulation((s) => s.setProfile)
  const preset = geolocationPresetOf(profile.geolocation)
  const value = profile.geolocation === null ? OFF : (preset?.id ?? CUSTOM_LOCATION)
  const [draft, setDraft] = useState(() =>
    profile.geolocation === null ? '' : formatLatLng(profile.geolocation)
  )
  const [invalid, setInvalid] = useState(false)

  const commit = (): void => {
    const geo = parseLatLng(draft)
    setInvalid(geo === null)
    if (geo !== null) setProfile({ geolocation: geo })
  }

  return (
    <>
      <Row label="Location">
        <Select
          value={value}
          onValueChange={(next) => {
            if (next === OFF) {
              setProfile({ geolocation: null })
              return
            }
            if (next === CUSTOM_LOCATION) {
              // Somewhere, until the coordinates are typed: the row has to
              // show the input, and the profile has to say "custom" to draw it.
              const custom = profile.geolocation ?? { latitude: 0, longitude: 0 }
              setDraft(formatLatLng(custom))
              setProfile({ geolocation: custom })
              return
            }
            const city = GEOLOCATION_PRESETS.find((candidate) => candidate.id === next)
            if (city === undefined) return
            setProfile({
              geolocation: { latitude: city.latitude, longitude: city.longitude },
              timezone: city.timezone
            })
          }}
        >
          <SelectTrigger aria-label="Location">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>Off</SelectItem>
            {GEOLOCATION_PRESETS.map((city) => (
              <SelectItem key={city.id} value={city.id}>
                {city.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_LOCATION}>Custom…</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {value === CUSTOM_LOCATION ? (
        <Row label="">
          <Input
            aria-label="Latitude, longitude"
            placeholder="lat, lng"
            value={draft}
            aria-invalid={invalid || undefined}
            className="h-7 px-2 text-micro"
            onChange={(event) => {
              setDraft(event.target.value)
              if (invalid) setInvalid(false)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
            }}
          />
        </Row>
      ) : null}
      {profile.geolocation === null ? null : (
        <p className="pl-[84px] text-micro text-muted-foreground">
          Sites still have to ask for permission.
        </p>
      )}
    </>
  )
}

/**
 * Everything the emulation pack can pretend, on one small surface.
 *
 * A popover rather than a dialog because none of this is a step in a task:
 * it is a set of switches someone flips while looking at the canvas, and the
 * canvas has to stay visible. Every control writes through immediately —
 * there is nothing here to try and then abandon, and Reset all is the undo.
 */
function EmulateForm(): React.JSX.Element {
  const profile = useEmulation((s) => s.profile)
  const setProfile = useEmulation((s) => s.setProfile)
  const resetAll = useEmulation((s) => s.resetAll)
  const active = useEmulation(selectEmulationActive)

  return (
    <div className="flex flex-col gap-2.5" data-testid="emulate-popover">
      <div className="flex items-center justify-between">
        <h3 className="text-caption font-medium text-foreground">Emulate</h3>
        <Button variant="ghost" size="xs" disabled={!active} onClick={resetAll}>
          Reset all
        </Button>
      </div>

      <Row label="Color scheme">
        <Segmented
          label="Color scheme"
          value={profile.colorScheme}
          choices={COLOR_SCHEMES}
          onChange={(colorScheme) => setProfile({ colorScheme })}
        />
      </Row>
      <Row label="">
        <div className="flex items-center gap-3">
          <Toggle
            id="emulate-reduced-motion"
            label="Reduced motion"
            checked={profile.reducedMotion}
            onChange={(reducedMotion) => setProfile({ reducedMotion })}
          />
          <Toggle
            id="emulate-forced-colors"
            label="Forced colors"
            checked={profile.forcedColors}
            onChange={(forcedColors) => setProfile({ forcedColors })}
          />
        </div>
      </Row>
      <Row label="Media">
        <Segmented
          label="Media type"
          value={profile.media}
          choices={MEDIA_TYPES}
          onChange={(media) => setProfile({ media })}
        />
      </Row>

      <Row label="Vision">
        <Select
          value={profile.vision}
          onValueChange={(vision) => setProfile({ vision: vision as VisionDeficiency })}
        >
          <SelectTrigger aria-label="Vision">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISION_DEFICIENCIES.map((type) => (
              <SelectItem key={type} value={type}>
                {VISION_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Network">
        <Select
          value={profile.network}
          onValueChange={(network) => setProfile({ network: network as NetworkPreset })}
        >
          <SelectTrigger aria-label="Network">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NETWORK_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {NETWORK_LABELS[preset]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <LocationRow profile={profile} />

      <Row label="Locale">
        <Select
          value={profile.locale ?? OFF}
          onValueChange={(locale) => setProfile({ locale: locale === OFF ? null : locale })}
        >
          <SelectTrigger aria-label="Locale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>Off</SelectItem>
            {LOCALE_PRESETS.map((preset) => (
              <SelectItem key={preset.tag} value={preset.tag}>
                {preset.label} · {preset.tag}
              </SelectItem>
            ))}
            {/* A tag restored from disk that is not on the list still has to be shown. */}
            {profile.locale !== null && !LOCALE_PRESETS.some((p) => p.tag === profile.locale) ? (
              <SelectItem value={profile.locale}>{profile.locale}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Time zone">
        <Select
          value={profile.timezone ?? OFF}
          onValueChange={(timezone) => setProfile({ timezone: timezone === OFF ? null : timezone })}
        >
          <SelectTrigger aria-label="Time zone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>Off</SelectItem>
            {TIMEZONE_PRESETS.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone}
              </SelectItem>
            ))}
            {profile.timezone !== null && !TIMEZONE_PRESETS.includes(profile.timezone) ? (
              <SelectItem value={profile.timezone}>{profile.timezone}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </Row>
    </div>
  )
}

/**
 * The toolbar's way into the emulation pack: one button, with a dot on it
 * whenever anything is switched on.
 *
 * The dot is the answer to "why does this page look strange": a dark-mode or
 * print override restored from yesterday must never be invisible, so the
 * badge is derived from the profile itself and the tooltip lists what is on.
 */
export function EmulateButton(): React.JSX.Element {
  const active = useEmulation(selectEmulationActive)
  const profile = useEmulation((s) => s.profile)
  const [open, setOpen] = useState(false)
  const summary = active ? describeEmulation(profile).join(' · ') : ''

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Emulate media, vision, network and location"
              data-emulating={active ? 'on' : 'off'}
              className={cn('relative', (active || open) && 'text-primary')}
            >
              <AdjustmentsHorizontalIcon />
              <span
                aria-hidden="true"
                data-slot="emulate-badge"
                className={cn(
                  'absolute top-1 right-1 size-1.5 rounded-full bg-primary',
                  'transition-opacity duration-150 ease-out',
                  active ? 'opacity-100' : 'opacity-0'
                )}
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {active ? `Emulating: ${summary}` : 'Emulate media, vision, network and location'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <EmulateForm />
      </PopoverContent>
    </Popover>
  )
}
