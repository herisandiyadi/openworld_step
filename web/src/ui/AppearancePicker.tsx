import { useRef } from 'react';
import { CATEGORIES, CATEGORY_IDS, type Category, optionLabel } from '../game/HeroAppearance';
import type { Appearance } from '../state/profile';

/**
 * Grup pilihan per kategori. Aksesibilitas (NEXT_FEATURES 9.2): role="radiogroup" + label,
 * role="radio" + aria-checked, nama opsi selalu dalam teks (bukan hanya warna), panah kiri/kanan,
 * dan tombol minimal 48 px (lihat .appearance-option di styles.css).
 */
export function AppearancePicker({ value, onChange }: { value: Appearance; onChange: (next: Appearance) => void }) {
  const groups = useRef<Record<string, HTMLDivElement | null>>({});

  const set = (category: Category, index: number) =>
    onChange(category === 'gender' ? { ...value, gender: index === 1 ? 'f' : 'm' } : { ...value, [category]: index });
  const indexOf = (category: Category) => (category === 'gender' ? (value.gender === 'f' ? 1 : 0) : value[category]);

  const onKeyDown = (category: Category, count: number) => (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (indexOf(category) + step + count) % count;
    set(category, next);
    const group = groups.current[category];
    (group?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="appearance-picker">
      {CATEGORY_IDS.map((category) => {
        const { label, options } = CATEGORIES[category];
        const selected = indexOf(category);
        return (
          <section key={category} className="appearance-group">
            <h2 className="appearance-label" id={`look-${category}`}>
              {label}
            </h2>
            <div
              className="appearance-options"
              role="radiogroup"
              aria-labelledby={`look-${category}`}
              ref={(node) => {
                groups.current[category] = node;
              }}
              onKeyDown={onKeyDown(category, options.length)}
            >
              {options.map((option, index) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={index === selected}
                  tabIndex={index === selected ? 0 : -1}
                  className={`appearance-option${index === selected ? ' selected' : ''}`}
                  onClick={() => set(category, index)}
                >
                  <span className="appearance-swatch" style={{ background: option.swatch }} aria-hidden="true" />
                  {optionLabel(category, index, value.gender)}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Pilihan acak untuk tombol "Acak". */
export const randomAppearance = (): Appearance => {
  const pick = () => Math.floor(Math.random() * 3);
  return {
    gender: Math.random() < 0.5 ? 'm' : 'f',
    skinTone: pick(),
    hairStyle: pick(),
    hairColor: pick(),
    expression: pick(),
    shirtColor: pick(),
    shirtStyle: pick(),
    pantsColor: pick(),
    pantsStyle: pick(),
    accessory: pick(),
  };
};
