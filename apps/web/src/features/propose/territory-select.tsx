import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";

export interface TerritorySelectProps {
  readonly choices: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly labelledBy: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}

export const TRIGGER =
  "tablet:text-ui tablet:h-9 h-11 w-full max-w-xs text-base";

export const TerritorySelect = ({
  choices,
  labelledBy,
  onChange,
  value,
}: TerritorySelectProps) => (
  <Select
    items={choices}
    name="territory"
    onValueChange={(chosen) => {
      onChange(chosen ?? "");
    }}
    value={value}
  >
    <SelectTrigger aria-labelledby={labelledBy} className={TRIGGER}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {choices.map(({ label, value: each }) => (
        <SelectItem key={each} value={each}>
          {each === "" ? (
            label
          ) : (
            <code className="text-mono font-mono">{label}</code>
          )}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

// `React.lazy` takes a module's default export.
export default TerritorySelect;
