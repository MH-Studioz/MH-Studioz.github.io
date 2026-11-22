import {
  AERO_PACKAGE_LABELS,
  CAR_CLASS_ORDER,
  CAR_CLASSES,
  DEFAULT_CONFIG,
  FINISH_LABELS,
  PATTERN_LABELS,
  cloneConfig,
  loadCarConfig,
  sanitizeConfig,
  saveCarConfig,
  type AeroPackage,
  type CarClass,
  type CarConfig,
  type FinishType,
  type LiveryPattern,
} from '../garage/carConfig';
import type { GaragePreview } from '../garage/garagePreview';
import { COMPOUNDS, type CompoundId } from '../physics/tyres';

function section(index: string, title: string, note = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = 'garage-section';
  el.innerHTML = `<div class="garage-section-title"><span>${index}</span><h3>${title}</h3>${note ? `<small>${note}</small>` : ''}</div>`;
  return el;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field-row';
  const span = document.createElement('span');
  span.textContent = label;
  row.append(span, control);
  return row;
}

export class GarageUI {
  private container: HTMLElement;
  private spec: HTMLElement;
  private preview: GaragePreview;
  private onExit: () => void;
  private config: CarConfig;
  private colorInputs: Record<'primary' | 'secondary' | 'accent' | 'visorTint', HTMLInputElement> | null = null;
  private finishChips: Array<{ btn: HTMLButtonElement; value: FinishType }> = [];
  private patternChips: Array<{ btn: HTMLButtonElement; value: LiveryPattern; swatch: HTMLElement }> = [];
  private aeroChips: Array<{ btn: HTMLButtonElement; value: AeroPackage }> = [];
  private classChips: Array<{ btn: HTMLButtonElement; value: CarClass }> = [];
  private compoundChips: Array<{ btn: HTMLButtonElement; value: CompoundId }> = [];
  private numberInput: HTMLInputElement | null = null;
  private tagInput: HTMLInputElement | null = null;
  private driverInput: HTMLInputElement | null = null;
  private teamInput: HTMLInputElement | null = null;
  private setupOutputs = new Map<string, HTMLOutputElement>();
  private setupInputs = new Map<string, HTMLInputElement>();

  constructor(container: HTMLElement, spec: HTMLElement, preview: GaragePreview, onExit: () => void) {
    this.container = container;
    this.spec = spec;
    this.preview = preview;
    this.onExit = onExit;
    this.config = loadCarConfig();
    this.build();
    this.sync();
    this.preview.setConfig(this.config);
  }

  open(): void {
    this.config = loadCarConfig();
    this.sync();
    this.preview.setConfig(this.config);
    this.container.scrollTop = 0;
  }

  private commit(visual: boolean): void {
    this.config = sanitizeConfig(this.config);
    saveCarConfig(this.config);
    if (visual) this.preview.setConfig(this.config);
    this.syncSelections();
    this.updateSpec();
  }

  private build(): void {
    this.container.innerHTML = '';

    // 01 — class.
    const carClass = section('01', 'RACE CLASS', '8 MODELS');
    const classGrid = document.createElement('div');
    classGrid.className = 'aero-grid';
    for (const value of CAR_CLASS_ORDER) {
      const spec = CAR_CLASSES[value];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip aero-card';
      btn.innerHTML = `<b>${spec.label}</b><small>${spec.blurb}</small>`;
      btn.addEventListener('click', () => {
        this.config.carClass = value;
        this.commit(true);
      });
      classGrid.appendChild(btn);
      this.classChips.push({ btn, value });
    }
    carClass.append(classGrid);

    // 02 — identity.
    const identity = section('02', 'TEAM IDENTITY', 'ON THE CAR');
    this.teamInput = document.createElement('input');
    this.teamInput.className = 'number-input';
    this.teamInput.style.width = '150px';
    this.teamInput.style.fontSize = '11px';
    this.teamInput.style.textAlign = 'left';
    this.teamInput.maxLength = 24;
    this.teamInput.addEventListener('input', () => {
      this.config.teamName = this.teamInput?.value ?? this.config.teamName;
      this.commit(true);
    });
    this.driverInput = document.createElement('input');
    this.driverInput.className = 'number-input';
    this.driverInput.style.width = '150px';
    this.driverInput.style.fontSize = '11px';
    this.driverInput.style.textAlign = 'left';
    this.driverInput.maxLength = 22;
    this.driverInput.addEventListener('input', () => {
      this.config.driverName = this.driverInput?.value ?? this.config.driverName;
      this.commit(true);
    });
    identity.append(field('TEAM NAME', this.teamInput), field('DRIVER NAME', this.driverInput));

    // 02 — paint.
    const paint = section('03', 'PAINT & FINISH', 'LIVE PREVIEW');
    const colors = document.createElement('div');
    colors.className = 'color-row';
    const makeColor = (key: 'primary' | 'secondary' | 'accent', label: string): HTMLInputElement => {
      const wrap = document.createElement('div');
      wrap.className = 'color-field';
      const input = document.createElement('input');
      input.type = 'color';
      const text = document.createElement('label');
      text.textContent = label;
      wrap.append(input, text);
      input.addEventListener('input', () => {
        this.config.livery[key] = input.value;
        this.updateSwatches();
        this.commit(true);
      });
      colors.appendChild(wrap);
      return input;
    };
    const primary = makeColor('primary', 'PRIMARY');
    const secondary = makeColor('secondary', 'SECONDARY');
    const accent = makeColor('accent', 'ACCENT');
    const visorWrap = document.createElement('div');
    visorWrap.className = 'color-field';
    const visor = document.createElement('input');
    visor.type = 'color';
    const visorLabel = document.createElement('label');
    visorLabel.textContent = 'VISOR';
    visorWrap.append(visor, visorLabel);
    visor.addEventListener('input', () => {
      this.config.livery.visorTint = visor.value;
      this.commit(true);
    });
    colors.appendChild(visorWrap);
    this.colorInputs = { primary, secondary, accent, visorTint: visor };

    const finishGrid = document.createElement('div');
    finishGrid.className = 'finish-grid';
    for (const value of ['gloss', 'matte', 'carbon'] as FinishType[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = FINISH_LABELS[value];
      btn.addEventListener('click', () => {
        this.config.livery.finish = value;
        this.commit(true);
      });
      finishGrid.appendChild(btn);
      this.finishChips.push({ btn, value });
    }
    paint.append(colors, finishGrid);

    // 03 — livery.
    const livery = section('04', 'LIVERY PATTERN', '5 PRESETS');
    const patternGrid = document.createElement('div');
    patternGrid.className = 'pattern-grid';
    for (const value of ['classic', 'fade', 'chevron', 'halftone', 'minimal'] as LiveryPattern[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip pattern-chip';
      const swatch = document.createElement('div');
      swatch.className = 'pattern-swatch';
      const label = document.createElement('span');
      label.textContent = PATTERN_LABELS[value].replace(' ', '\n');
      btn.append(swatch, label);
      btn.addEventListener('click', () => {
        this.config.livery.pattern = value;
        this.commit(true);
      });
      patternGrid.appendChild(btn);
      this.patternChips.push({ btn, value, swatch });
    }
    livery.append(patternGrid);

    // 04 — number, tag, visor already in paint.
    const identityRace = section('05', 'RACE IDENTITY', 'CANVAS DECALS');
    this.numberInput = document.createElement('input');
    this.numberInput.type = 'number';
    this.numberInput.min = '1';
    this.numberInput.max = '99';
    this.numberInput.className = 'number-input';
    this.numberInput.addEventListener('input', () => {
      const n = Number(this.numberInput?.value);
      if (Number.isFinite(n)) this.config.livery.number = Math.max(1, Math.min(99, Math.round(n)));
      this.commit(true);
    });
    this.tagInput = document.createElement('input');
    this.tagInput.className = 'tag-input';
    this.tagInput.maxLength = 3;
    this.tagInput.addEventListener('input', () => {
      const clean = (this.tagInput?.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      if (this.tagInput) this.tagInput.value = clean;
      if (clean) this.config.livery.tag = clean;
      this.commit(true);
    });
    identityRace.append(field('DRIVER NUMBER', this.numberInput), field('3-LETTER TAG', this.tagInput));

    // 05 — aero.
    const aero = section('06', 'AERO PACKAGE', 'CHANGES PHYSICS');
    const aeroGrid = document.createElement('div');
    aeroGrid.className = 'aero-grid';
    const impacts: Record<AeroPackage, string> = {
      'low-drag': '+ top speed · − grip',
      balanced: 'Reference balance',
      'high-downforce': '+ grip · − top speed',
    };
    for (const value of ['low-drag', 'balanced', 'high-downforce'] as AeroPackage[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip aero-card';
      btn.innerHTML = `<b>${AERO_PACKAGE_LABELS[value].replace(' Spec', '')}</b><small>${impacts[value]}</small>`;
      btn.addEventListener('click', () => {
        this.config.livery.aero = value;
        this.commit(true);
      });
      aeroGrid.appendChild(btn);
      this.aeroChips.push({ btn, value });
    }
    aero.append(aeroGrid);

    // 06 — setup.
    const setup = section('07', 'CAR SETUP', 'SETUP TUNING');
    const sliders: Array<{ key: 'frontWingAngle' | 'rearWingAngle' | 'brakeBias' | 'diffOnThrottle' | 'suspensionStiffness' | 'rideHeight'; label: string; min: number; max: number; unit: string }> = [
      { key: 'frontWingAngle', label: 'FRONT WING', min: 0, max: 20, unit: '°' },
      { key: 'rearWingAngle', label: 'REAR WING', min: 0, max: 25, unit: '°' },
      { key: 'brakeBias', label: 'BRAKE BIAS', min: 50, max: 62, unit: '%' },
      { key: 'diffOnThrottle', label: 'DIFF ON THROTTLE', min: 0, max: 100, unit: '%' },
      { key: 'suspensionStiffness', label: 'SUSPENSION', min: 0, max: 100, unit: '' },
      { key: 'rideHeight', label: 'RIDE HEIGHT', min: 30, max: 80, unit: ' MM' },
    ];
    for (const s of sliders) {
      const row = document.createElement('div');
      row.className = 'setup-row';
      const label = document.createElement('label');
      label.textContent = s.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = '1';
      const out = document.createElement('output');
      input.addEventListener('input', () => {
        const value = Number(input.value);
        this.config.setup[s.key] = value;
        out.textContent = `${value}${s.unit}`;
        this.updateSpec();
        this.commit(false);
      });
      row.append(label, input, out);
      setup.appendChild(row);
      this.setupInputs.set(s.key, input);
      this.setupOutputs.set(s.key, out);
    }

    // 07 — starting tyre.
    const tyre = section('08', 'STARTING TYRE', 'SAVED TO GARAGE');
    const compoundGrid = document.createElement('div');
    compoundGrid.className = 'compound-grid';
    for (const value of ['soft', 'medium', 'hard', 'intermediate', 'wet'] as CompoundId[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip compound-chip';
      const dot = document.createElement('i');
      dot.style.color = COMPOUNDS[value].color;
      const label = document.createElement('span');
      label.textContent = COMPOUNDS[value].short;
      btn.append(dot, label);
      btn.title = COMPOUNDS[value].label;
      btn.addEventListener('click', () => {
        this.config.livery.compound = value;
        this.commit(false);
      });
      compoundGrid.appendChild(btn);
      this.compoundChips.push({ btn, value });
    }
    tyre.append(compoundGrid);

    const footer = document.createElement('div');
    footer.className = 'diff-sub';
    footer.style.marginTop = '14px';
    footer.textContent = 'All changes are stored automatically in localStorage. AERO, WING ANGLES AND RIDE HEIGHT FEED DIRECTLY INTO THE 120 HZ PHYSICS.';
    this.container.append(carClass, identity, paint, livery, identityRace, aero, setup, tyre, footer);

    document.getElementById('garage-save')?.addEventListener('click', () => this.finish());
    document.getElementById('garage-back')?.addEventListener('click', () => this.finish());
    document.getElementById('garage-reset')?.addEventListener('click', () => {
      this.config = cloneConfig(DEFAULT_CONFIG);
      saveCarConfig(this.config);
      this.preview.setConfig(this.config);
      this.sync();
    });
  }

  private finish(): void {
    this.config = sanitizeConfig(this.config);
    saveCarConfig(this.config);
    this.onExit();
  }

  private sync(): void {
    const c = this.config;
    if (this.colorInputs) {
      this.colorInputs.primary.value = c.livery.primary;
      this.colorInputs.secondary.value = c.livery.secondary;
      this.colorInputs.accent.value = c.livery.accent;
      this.colorInputs.visorTint.value = c.livery.visorTint;
    }
    if (this.numberInput) this.numberInput.value = String(c.livery.number);
    if (this.tagInput) this.tagInput.value = c.livery.tag;
    if (this.teamInput) this.teamInput.value = c.teamName;
    if (this.driverInput) this.driverInput.value = c.driverName;
    for (const [key, input] of this.setupInputs) {
      const setupKey = key as keyof typeof c.setup;
      input.value = String(c.setup[setupKey]);
      const out = this.setupOutputs.get(key);
      const units: Record<string, string> = {
        frontWingAngle: '°',
        rearWingAngle: '°',
        brakeBias: '%',
        diffOnThrottle: '%',
        suspensionStiffness: '',
        rideHeight: ' MM',
      };
      if (out) out.textContent = `${c.setup[setupKey]}${units[key] ?? ''}`;
    }
    this.syncSelections();
    this.updateSwatches();
    this.updateSpec();
  }

  private syncSelections(): void {
    const c = this.config;
    for (const chip of this.finishChips) chip.btn.classList.toggle('active', chip.value === c.livery.finish);
    for (const chip of this.patternChips) chip.btn.classList.toggle('active', chip.value === c.livery.pattern);
    for (const chip of this.aeroChips) chip.btn.classList.toggle('active', chip.value === c.livery.aero);
    for (const chip of this.classChips) chip.btn.classList.toggle('active', chip.value === c.carClass);
    for (const chip of this.compoundChips) chip.btn.classList.toggle('active', chip.value === c.livery.compound);
  }

  private updateSwatches(): void {
    const l = this.config.livery;
    for (const chip of this.patternChips) {
      let bg = '';
      if (chip.value === 'classic') {
        bg = `repeating-linear-gradient(90deg, ${l.primary} 0 18%, ${l.secondary} 18% 30%, ${l.accent} 30% 34%)`;
      } else if (chip.value === 'fade') {
        bg = `linear-gradient(90deg, ${l.primary}, ${l.secondary} 62%, ${l.accent})`;
      } else if (chip.value === 'chevron') {
        bg = `linear-gradient(135deg, ${l.primary} 0 28%, ${l.accent} 28% 38%, ${l.secondary} 38% 68%, ${l.primary} 68%)`;
      } else if (chip.value === 'halftone') {
        bg = `radial-gradient(circle, ${l.primary} 22%, transparent 23%) 0 0/7px 7px, linear-gradient(180deg, ${l.secondary}, ${l.accent})`;
      } else {
        bg = `linear-gradient(180deg, ${l.secondary} 0 58%, ${l.primary} 58% 82%, ${l.accent} 82%)`;
      }
      chip.swatch.style.background = bg;
    }
  }

  private updateSpec(): void {
    const aero = this.config.livery.aero;
    const carClass = CAR_CLASSES[this.config.carClass];
    const pkgOffset = aero === 'low-drag' ? 13 : aero === 'high-downforce' ? -15 : 0;
    const topSpeedBase: Record<CarClass, number> = {
      hybrid: 341,
      v10: 350,
      junior: 289,
      gt: 305,
      prototype: 330,
      hypercar: 352,
      stock: 310,
      rally: 205,
      kart: 115,
    };
    const aeroAuthority =
      carClass.id === 'hypercar'
        ? 0.5
        : carClass.category === 'open-wheel'
          ? 1
          : carClass.category === 'prototype'
            ? 0.52
            : carClass.category === 'gt'
              ? 0.32
              : 0.04;
    const topSpeed = Math.round(
      topSpeedBase[carClass.id] +
        pkgOffset * aeroAuthority -
        (this.config.setup.rearWingAngle - 13) * 1.4 * aeroAuthority -
        (this.config.setup.frontWingAngle - 11) * 0.45 * aeroAuthority,
    );
    const grip = Math.round(
      ((aero === 'high-downforce' ? 100 : aero === 'low-drag' ? 74 : 88) + (this.config.setup.rearWingAngle - 13) * 0.7 + (this.config.setup.frontWingAngle - 11) * 0.5) *
        carClass.grip,
    );
    const balanceRaw = this.config.setup.frontWingAngle / 20 - this.config.setup.rearWingAngle / 25;
    const balance = balanceRaw > 0.08 ? 'FRONT-LIMITED' : balanceRaw < -0.08 ? 'REAR-STABLE' : 'NEUTRAL';
    this.spec.innerHTML = `
      <div><span>CLASS</span><br><b>${carClass.label.toUpperCase()}</b></div>
      <div><span>TOP SPEED</span><br><b>${topSpeed} KM/H</b></div>
      <div><span>AERO GRIP</span><br><b>${Math.max(55, Math.min(110, grip))}%</b></div>
      <div><span>BALANCE</span><br><b>${balance}</b></div>
      <div><span>TYRE</span><br><b>${COMPOUNDS[this.config.livery.compound].label.toUpperCase()}</b></div>
    `;
  }
}
