import { Monitor, Moon, ShieldCheck, ShieldAlert, Sun } from 'lucide-react';
import { useStore } from '../store';
import { Card, PageHeader, Segmented } from '../components/ui';
import { UpdateSettings } from '../components/Update';

export default function Settings() {
  const { settings, setSettings, info } = useStore();
  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" subtitle="Tune DevPulse to your workflow." />

      <Card title="Updates">
        <UpdateSettings />
      </Card>

      <Card title="Appearance">
        <Row label="Theme" hint="Follow Windows or pick one.">
          <Segmented
            value={settings.theme}
            onChange={(theme) => setSettings({ theme })}
            options={[
              { value: 'dark', label: <><Moon size={14} /> Dark</> },
              { value: 'light', label: <><Sun size={14} /> Light</> },
              { value: 'system', label: <><Monitor size={14} /> System</> },
            ]}
          />
        </Row>
        <Row label="Always on top" hint="Keep DevPulse above other windows, handy on a second screen.">
          <input type="checkbox" className="switch" checked={settings.alwaysOnTop} onChange={(e) => setSettings({ alwaysOnTop: e.target.checked })} />
        </Row>
      </Card>

      <Card title="Monitoring">
        <Row label="Refresh rate" hint="Faster feels more live; slower uses less CPU.">
          <Segmented
            value={settings.interval}
            onChange={(interval) => setSettings({ interval })}
            options={[
              { value: 500, label: '0.5s' },
              { value: 1000, label: '1s' },
              { value: 2000, label: '2s' },
              { value: 5000, label: '5s' },
            ]}
          />
        </Row>
        <Row label="Show UDP ports" hint="UDP sockets are mostly Windows services; hidden by default.">
          <input type="checkbox" className="switch" checked={settings.showUdp} onChange={(e) => setSettings({ showUdp: e.target.checked })} />
        </Row>
      </Card>

      <Card title="Safety">
        <Row label="Confirm before killing" hint="Ask before ending a process or freeing a port.">
          <input type="checkbox" className="switch" checked={settings.confirmKill} onChange={(e) => setSettings({ confirmKill: e.target.checked })} />
        </Row>
        <Row
          label="Administrator mode"
          hint={info?.admin ? 'Running elevated: you can end services and see every command line.' : 'Needed to end services or processes started by other users.'}
        >
          {info?.admin ? (
            <span className="pill pill-green"><ShieldCheck size={14} /> Elevated</span>
          ) : (
            <button className="btn btn-ghost" onClick={() => window.devpulse.relaunchAsAdmin()}><ShieldAlert size={15} /> Restart as admin</button>
          )}
        </Row>
      </Card>

      <Card title="Keyboard shortcuts">
        <div className="shortcuts">
          <Shortcut keys={['Ctrl', 'K']} label="Command palette: type a port to kill it" />
          <Shortcut keys={['Ctrl', '1']} label="Dashboard" />
          <Shortcut keys={['Ctrl', '2']} label="Ports" />
          <Shortcut keys={['Ctrl', '3']} label="Processes" />
          <Shortcut keys={['Ctrl', '4']} label="Security" />
          <Shortcut keys={['Ctrl', '5']} label="Optimize" />
          <Shortcut keys={['Ctrl', 'F']} label="Search on the current page" />
          <Shortcut keys={['Ctrl', ',']} label="Settings" />
        </div>
      </Card>

      <p className="about">DevPulse · built for {info?.user || 'you'} on {info?.hostname || 'this PC'}</p>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div>
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="shortcut">
      <span>{label}</span>
      <span className="keys">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
    </div>
  );
}
