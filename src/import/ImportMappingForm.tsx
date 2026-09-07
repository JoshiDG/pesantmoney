import { ColumnMapping, ImportProfile, SIGN_CONVENTION_LABELS, SignConvention } from "./types";

interface ImportMappingFormProps {
  profiles: ImportProfile[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  institutionName: string;
  onInstitutionNameChange: (name: string) => void;
  onSelectProfile: (profile: ImportProfile) => void;
}

function numberInput(value: number, onChange: (value: number) => void, label: string) {
  return (
    <input
      aria-label={label}
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
}

export function ImportMappingForm({
  profiles,
  mapping,
  onMappingChange,
  institutionName,
  onInstitutionNameChange,
  onSelectProfile,
}: ImportMappingFormProps) {
  return (
    <div className="import-mapping-form">
      {profiles.length > 0 && (
        <label className="import-field">
          <span>Use a saved Import Profile</span>
          <select
            aria-label="Saved import profile"
            defaultValue=""
            onChange={(e) => {
              const profile = profiles.find((p) => String(p.id) === e.currentTarget.value);
              if (profile) {
                onSelectProfile(profile);
              }
            }}
          >
            <option value="">Choose a profile…</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.institution_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="import-field">
        <span>Institution name</span>
        <input
          aria-label="Institution name"
          placeholder="e.g. Ally Bank"
          value={institutionName}
          onChange={(e) => onInstitutionNameChange(e.currentTarget.value)}
        />
      </label>

      <div className="import-field-row">
        <label className="import-field">
          <span>Date column</span>
          {numberInput(mapping.date_column, (v) => onMappingChange({ ...mapping, date_column: v }), "Date column")}
        </label>
        <label className="import-field">
          <span>Amount column</span>
          {numberInput(mapping.amount_column, (v) => onMappingChange({ ...mapping, amount_column: v }), "Amount column")}
        </label>
        <label className="import-field">
          <span>Description column</span>
          {numberInput(
            mapping.description_column,
            (v) => onMappingChange({ ...mapping, description_column: v }),
            "Description column",
          )}
        </label>
      </div>

      <label className="import-field">
        <span>Sign convention</span>
        <select
          aria-label="Sign convention"
          value={mapping.sign_convention}
          onChange={(e) =>
            onMappingChange({ ...mapping, sign_convention: e.currentTarget.value as SignConvention })
          }
        >
          {(Object.keys(SIGN_CONVENTION_LABELS) as SignConvention[]).map((convention) => (
            <option key={convention} value={convention}>
              {SIGN_CONVENTION_LABELS[convention]}
            </option>
          ))}
        </select>
      </label>

      <label className="import-field import-checkbox-field">
        <input
          aria-label="File has a header row"
          type="checkbox"
          checked={mapping.has_header_row}
          onChange={(e) => onMappingChange({ ...mapping, has_header_row: e.currentTarget.checked })}
        />
        <span>First row is a header</span>
      </label>
    </div>
  );
}
