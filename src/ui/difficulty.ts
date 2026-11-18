import {
  DIFFICULTY_PRESETS,
  loadDifficulty,
  preset,
  saveDifficulty,
  type AssistSettings,
  type DifficultyPresetId,
  type DifficultySettings,
  type SimSettings,
} from '../physics/settings';

function segment<T extends string>(
  options: Array<{ label: string; value: T }>,
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opt.label;
    if (opt.value === current) btn.classList.add('active');
    btn.addEventListener('click', () => onPick(opt.value));
    wrap.appendChild(btn);
  }
  return wrap;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'diff-row';
  const l = document.createElement('label');
  l.textContent = label;
  div.append(l, control);
  return div;
}

function groupTitle(text: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'diff-group-title';
  div.textContent = text;
  return div;
}

export class DifficultyPanel {
  private container: HTMLElement;
  private onChange: (settings: DifficultySettings) => void;
  settings: DifficultySettings;

  constructor(container: HTMLElement, onChange: (settings: DifficultySettings) => void) {
    this.container = container;
    this.onChange = onChange;
    this.settings = loadDifficulty();
    this.render();
  }

  private commit(reRender = true): void {
    saveDifficulty(this.settings);
    this.onChange(this.settings);
    if (reRender) this.render();
  }

  setPreset(id: DifficultyPresetId): void {
    if (id === 'custom') {
      this.settings.preset = 'custom';
      this.commit();
      return;
    }
    const p = preset(id);
    this.settings = {
      preset: id,
      aiPace: p.aiPace,
      assists: { ...p.assists },
      sim: { ...p.sim },
    };
    this.commit();
  }

  setAssist<K extends keyof AssistSettings>(key: K, value: AssistSettings[K]): void {
    this.settings.assists[key] = value;
    this.settings.preset = 'custom';
    this.commit();
  }

  setSim<K extends keyof SimSettings>(key: K, value: SimSettings[K]): void {
    this.settings.sim[key] = value;
    this.settings.preset = 'custom';
    this.commit();
  }

  render(): void {
    const scroll = this.container.scrollTop;
    const s = this.settings;
    this.container.innerHTML = '';

    const pills = document.createElement('div');
    pills.className = 'preset-pills';
    for (const p of DIFFICULTY_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-pill';
      btn.textContent = p.label.split(' ')[0];
      btn.title = p.blurb;
      if (s.preset === p.id) btn.classList.add('active');
      btn.addEventListener('click', () => this.setPreset(p.id));
      pills.appendChild(btn);
    }
    this.container.appendChild(pills);

    const blurb = document.createElement('div');
    blurb.className = 'diff-sub';
    blurb.textContent = s.preset === 'custom' ? 'Custom race control — assists and realism set manually.' : preset(s.preset).blurb;
    this.container.appendChild(blurb);

    // AI pace.
    const paceWrap = document.createElement('div');
    paceWrap.style.flex = '1';
    const paceLabel = document.createElement('div');
    paceLabel.style.cssText = 'display:flex;justify-content:space-between;font-family:var(--font);font-size:8px;color:var(--muted);letter-spacing:.08em;margin-bottom:4px;';
    paceLabel.innerHTML = `<span>AI PACE</span><span style="color:var(--red);font-size:11px">${Math.round(s.aiPace)}%</span>`;
    const pace = document.createElement('input');
    pace.type = 'range';
    pace.min = '50';
    pace.max = '110';
    pace.step = '1';
    pace.value = String(s.aiPace);
    pace.className = 'range-compact';
    pace.addEventListener('input', () => {
      this.settings.aiPace = Number(pace.value);
      this.settings.preset = 'custom';
      saveDifficulty(this.settings);
      this.onChange(this.settings);
      paceLabel.lastElementChild!.textContent = `${Math.round(this.settings.aiPace)}%`;
      for (const p of pills.querySelectorAll('button')) p.classList.remove('active');
    });
    paceWrap.append(paceLabel, pace);
    const paceRow = document.createElement('div');
    paceRow.className = 'diff-row';
    paceRow.style.display = 'block';
    paceRow.appendChild(paceWrap);
    this.container.appendChild(paceRow);

    this.container.appendChild(groupTitle('DRIVING ASSISTS'));
    this.container.appendChild(
      row('BRAKING ASSIST', segment(
        [
          { label: 'OFF', value: 'off' as const },
          { label: 'LOW', value: 'low' as const },
          { label: 'HIGH', value: 'high' as const },
        ],
        s.assists.brakingAssist,
        (v) => this.setAssist('brakingAssist', v),
      )),
    );
    this.container.appendChild(
      row('ABS', segment(
        [
          { label: 'OFF', value: 'off' },
          { label: 'ON', value: 'on' },
        ],
        s.assists.abs ? 'on' : 'off',
        (v) => this.setAssist('abs', v === 'on'),
      )),
    );
    this.container.appendChild(
      row('TRACTION CONTROL', segment(
        [
          { label: 'OFF', value: 'off' as const },
          { label: 'MED', value: 'medium' as const },
          { label: 'FULL', value: 'full' as const },
        ],
        s.assists.tractionControl,
        (v) => this.setAssist('tractionControl', v),
      )),
    );
    this.container.appendChild(
      row('RACING LINE', segment(
        [
          { label: 'OFF', value: 'off' as const },
          { label: 'CORNERS', value: 'corners' as const },
          { label: 'FULL', value: 'full' as const },
        ],
        s.assists.racingLine,
        (v) => this.setAssist('racingLine', v),
      )),
    );
    this.container.appendChild(
      row('GEARBOX', segment(
        [
          { label: 'AUTO', value: 'auto' as const },
          { label: 'PADDLES', value: 'manual' as const },
        ],
        s.assists.gearbox,
        (v) => this.setAssist('gearbox', v),
      )),
    );

    this.container.appendChild(groupTitle('SIMULATION REALISM'));
    this.container.appendChild(
      row('DAMAGE', segment(
        [
          { label: 'OFF', value: 'off' as const },
          { label: 'VISUAL', value: 'visual' as const },
          { label: 'REDUCED', value: 'reduced' as const },
          { label: 'FULL', value: 'full' as const },
        ],
        s.sim.damage,
        (v) => this.setSim('damage', v),
      )),
    );
    this.container.appendChild(
      row('TYRE WEAR', segment(
        [
          { label: '1×', value: '1x' as const },
          { label: '2×', value: '2x' as const },
          { label: 'OFF', value: 'off' as const },
        ],
        s.sim.tyreWear,
        (v) => this.setSim('tyreWear', v),
      )),
    );
    this.container.appendChild(
      row('FUEL LOAD', segment(
        [
          { label: 'ON', value: 'on' },
          { label: 'OFF', value: 'off' },
        ],
        s.sim.fuel ? 'on' : 'off',
        (v) => this.setSim('fuel', v === 'on'),
      )),
    );
    this.container.appendChild(
      row('TRACK LIMITS', segment(
        [
          { label: 'OFF', value: 'off' as const },
          { label: 'LENIENT', value: 'lenient' as const },
          { label: 'STRICT', value: 'strict' as const },
        ],
        s.sim.trackLimits,
        (v) => this.setSim('trackLimits', v),
      )),
    );

    const note = document.createElement('div');
    note.className = 'diff-sub';
    note.style.marginTop = '9px';
    note.textContent = 'Braking assist, ABS and TC change the physics. Strict limits give a 5 s penalty every third off-track strike.';
    this.container.appendChild(note);
    this.container.scrollTop = scroll;
  }
}
