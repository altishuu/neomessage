"use client";

interface PasswordStrengthProps {
  password: string;
}

const CRITERIA = [
  { test: (p: string) => p.length >= 8, label: "8+ chars" },
  { test: (p: string) => /[A-Z]/.test(p), label: "Uppercase" },
  { test: (p: string) => /[a-z]/.test(p), label: "Lowercase" },
  { test: (p: string) => /\d/.test(p), label: "Digit" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "Special" },
];

function getStrength(password: string): { score: number; label: string } {
  const score = CRITERIA.filter((c) => c.test(password)).length;

  let label: string;
  if (score <= 1) label = "Weak";
  else if (score === 2) label = "Fair";
  else if (score === 3) label = "Good";
  else label = "Strong";

  return { score, label };
}

function scoreColor(score: number): string {
  if (score <= 1) return "text-red";
  if (score === 2) return "text-amber";
  if (score === 3) return "text-amber";
  return "text-green";
}

/** Each bar segment's colour when active, creating a red→amber→green gradient. */
const SEGMENT_COLORS = [
  "bg-red",
  "bg-red/50",
  "bg-amber",
  "bg-green/50",
  "bg-green",
] as const;

export function PasswordStrength({ password }: PasswordStrengthProps) {
  if (!password) return null;

  const { score, label } = getStrength(password);

  return (
    <div className="space-y-1.5" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={5}>
      {/* 5-segment bar */}
      <div className="flex gap-[3px]">
        {CRITERIA.map((criterion, i) => (
          <div
            key={criterion.label}
            className={`h-1.5 flex-1 rounded-sm transition-colors duration-300 ${
              i < score ? SEGMENT_COLORS[i] : "bg-border"
            }`}
          />
        ))}
      </div>

      {/* Strength label with indicator */}
      <div className="flex items-center justify-between">
        <p className={`font-mono text-xs ${scoreColor(score)} transition-colors duration-300`}>
          {label}
        </p>
        {score >= 4 && (
          <span className="font-mono text-[10px] text-green uppercase tracking-wider">
            ✓ Secure
          </span>
        )}
      </div>
    </div>
  );
}
