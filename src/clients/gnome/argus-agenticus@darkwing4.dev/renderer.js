import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { AGENT_TYPES, HOVER_SCALE, MARGIN_DIFFERENT_GROUP } from './constants.js';

export class Renderer {

    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        this._dotWidgets = new Map();
        this._groupContainers = new Map();
        this._groupLabels = new Map();
        this._groupAfButtons = new Map();
        this._tooltip = null;
        this._logo = null;
        this._autoFocusButton = null;
        this._autoFocusLabel = null;
        this._groupsBox = null;
    }

    createPanelContent() {
        const file = Gio.File.new_for_path(this._extensionPath + '/logo.png');
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const texture = St.TextureCache.get_default().load_file_async(file, -1, 14, scaleFactor, scaleFactor);
        this._logo = new St.Button({
            style_class: 'argus-logo',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: texture,
        });

        this._autoFocusButton = new St.Button({
            style_class: 'auto-focus-button',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._autoFocusLabel = new St.Label({
            text: 'A',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._autoFocusButton.set_child(this._autoFocusLabel);

        this._groupsBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
        });

        return {
            logo: this._logo,
            autoFocusButton: this._autoFocusButton,
            groupsBox: this._groupsBox,
        };
    }

    updateDots(agents, callbacks, options = {}) {
        const { dotSize = 10, showLabels = false, dotGap = 4, fontSize = 11, groupPadding = 0, afLabelSizePercent = 80 } = options;
        const hPad = Math.round(dotGap / 2);
        const size = dotSize;
        const radius = Math.round(size / 2);
        this._fontSize = fontSize;

        const activeKeys = new Set(agents.map(a => a.session));
        const activeGroups = new Set(agents.map(a => a.group));

        for (const [session, widgets] of this._dotWidgets) {
            if (!activeKeys.has(session)) {
                widgets.button.get_parent()?.remove_child(widgets.button);
                widgets.button.destroy();
                this._dotWidgets.delete(session);
            }
        }

        for (const [groupId, container] of this._groupContainers) {
            if (!activeGroups.has(groupId)) {
                container.remove_all_children();
                this._groupsBox.remove_child(container);
                container.destroy();
                this._groupContainers.delete(groupId);
                if (this._groupLabels.has(groupId)) {
                    this._groupLabels.delete(groupId);
                }
                if (this._groupAfButtons.has(groupId)) {
                    this._groupAfButtons.delete(groupId);
                }
            }
        }

        const groups = new Map();
        for (const agent of agents) {
            if (!groups.has(agent.group))
                groups.set(agent.group, []);
            groups.get(agent.group).push(agent);
        }

        let groupIndex = 0;
        for (const [groupId, groupAgents] of groups) {
            let container = this._groupContainers.get(groupId);
            if (!container) {
                container = new St.BoxLayout({
                    style_class: 'agent-group',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._groupContainers.set(groupId, container);
                this._groupsBox.add_child(container);
            }

            const isFocused = groupAgents.some(a => a.focused);
            if (isFocused)
                container.add_style_class_name('agent-group-focused');
            else
                container.remove_style_class_name('agent-group-focused');

            const marginStyle = groupIndex > 0 ? `margin-left: ${MARGIN_DIFFERENT_GROUP}px; ` : '';
            const paddingStyle = groupPadding > 0 ? `padding: 0 ${groupPadding}px;` : '';
            container.style = marginStyle + paddingStyle;

            const groupName = groupAgents[0].session.split('#')[0];
            let label = this._groupLabels.get(groupId);
            if (showLabels) {
                if (!label) {
                    label = new St.Label({
                        style_class: 'agent-group-label',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    this._groupLabels.set(groupId, label);
                    label.style = `padding-right: ${hPad}px; font-size: ${fontSize}px;`;
                    container.add_child(label);
                }
                label.text = groupName;
                label.style = `padding-right: ${hPad}px; font-size: ${fontSize}px;`;
            } else if (label) {
                container.remove_child(label);
                label.destroy();
                this._groupLabels.delete(groupId);
            }

            for (let i = 0; i < groupAgents.length; i++) {
                const agent = groupAgents[i];
                let widgets = this._dotWidgets.get(agent.session);

                if (!widgets) {
                    widgets = this._createDot(agent, callbacks);
                    this._dotWidgets.set(agent.session, widgets);
                }

                this._setDotState(widgets.dot, agent.state);
                this._setDotType(widgets.dot, agent.agent_type);
                if (widgets.agentData) widgets.agentData.current = agent;

                widgets.dot.width = size;
                widgets.dot.height = size;
                widgets.dot.style = `border-radius: ${radius}px;`;

                if (widgets.button.get_parent() !== container) {
                    widgets.button.get_parent()?.remove_child(widgets.button);
                    container.add_child(widgets.button);
                }

                container.set_child_at_index(widgets.button, i);
                widgets.button.style = `padding: 8px ${hPad}px;`;
            }

            let afBtn = this._groupAfButtons.get(groupId);
            if (groupAgents.length > 1) {
                if (!afBtn) {
                    afBtn = this._createGroupAfButton(groupName, callbacks);
                    this._groupAfButtons.set(groupId, afBtn);
                }
                afBtn._groupName = groupName;
                let groupMode = 2;
                for (const a of groupAgents) {
                    const m = a.auto_focus_mode | 0;
                    if (m < groupMode) groupMode = m;
                }
                const afLabel = afBtn.get_child();
                if (afLabel) {
                    afLabel.text = groupMode === 2 ? 'A+' : 'A';
                    const afSize = Math.max(6, Math.round(size * afLabelSizePercent / 100));
                    afLabel.style = `font-size: ${afSize}px;`;
                }
                if (groupMode > 0)
                    afBtn.add_style_class_name('agent-group-af-button-on');
                else
                    afBtn.remove_style_class_name('agent-group-af-button-on');
                if (afBtn.get_parent() !== container)
                    container.add_child(afBtn);
                container.set_child_at_index(afBtn, groupAgents.length + (showLabels ? 1 : 0));
                afBtn.style = `padding: 8px ${hPad}px;`;
                afBtn.visible = true;
            } else if (afBtn) {
                afBtn.get_parent()?.remove_child(afBtn);
                afBtn.destroy();
                this._groupAfButtons.delete(groupId);
            }

            this._groupsBox.set_child_at_index(container, groupIndex);
            groupIndex++;
        }

        return agents.length > 0;
    }

    showTooltip(anchor, text) {
        this.hideTooltip();

        this._tooltip = new St.Label({
            text: text,
            style_class: 'dash-label',
            style: `font-size: ${this._fontSize || 11}px; border-radius: 2px;`,
        });

        Main.uiGroup.add_child(this._tooltip);

        const [x, y] = anchor.get_transformed_position();
        const [anchorWidth, anchorHeight] = anchor.get_size();
        this._tooltip.ensure_style();
        const [tipWidth] = this._tooltip.get_size();

        this._tooltip.set_position(
            Math.round(x + anchorWidth / 2 - tipWidth / 2),
            Math.round(y + anchorHeight + 6)
        );
    }

    hideTooltip() {
        if (this._tooltip) {
            Main.uiGroup.remove_child(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
    }

    updateAutoFocusButtonStyle(enabled) {
        if (enabled)
            this._autoFocusButton.add_style_class_name('auto-focus-enabled');
        else
            this._autoFocusButton.remove_style_class_name('auto-focus-enabled');
    }

    destroy() {
        this.hideTooltip();
        this._dotWidgets.clear();
        this._groupContainers.clear();
        this._groupLabels.clear();
        this._groupAfButtons.clear();
    }

    _createGroupAfButton(groupName, callbacks) {
        const btn = new St.Button({
            style_class: 'agent-group-af-button',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            text: 'A',
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.set_child(label);
        btn._groupName = groupName;
        btn.connect('clicked', () => {
            callbacks.onGroupAutoFocusClicked?.(btn._groupName);
        });
        btn.connect('enter-event', () => {
            this.showTooltip(btn, 'Auto-focus all in group');
        });
        btn.connect('leave-event', () => {
            this.hideTooltip();
        });
        return btn;
    }

    _createDot(agent, callbacks) {
        const button = new St.Button({
            style: 'padding: 8px 2px;',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const typeInfo = AGENT_TYPES[agent.agent_type];
        const dotClass = typeInfo?.dotClass
            ? `agent-dot agent-dot-${agent.state} ${typeInfo.dotClass}`
            : `agent-dot agent-dot-${agent.state}`;

        const dot = new St.Widget({
            style_class: dotClass,
            width: 10,
            height: 10,
        });

        button.set_child(dot);

        const agentData = { current: agent };

        button.connect('enter-event', () => {
            dot.set_scale(HOVER_SCALE, HOVER_SCALE);
            this.showTooltip(button, this._buildTooltip(agentData.current));
        });

        button.connect('leave-event', () => {
            dot.set_scale(1, 1);
            this.hideTooltip();
        });

        button.connect('clicked', () => {
            callbacks.onDotClicked?.(agentData.current.session);
        });

        return { button, dot, agentData };
    }

    _buildTooltip(agent) {
        const lines = [agent.session];

        if (agent.state === 'awaiting' && agent.awaiting_since_unix) {
            const elapsed = Math.floor(Date.now() / 1000) - agent.awaiting_since_unix;
            if (elapsed > 0)
                lines.push(`Ожидает ${this._formatDuration(elapsed)}`);
        }

        if (agent.tool)
            lines.push(`tool: ${agent.tool}`);

        if (agent.uncommitted_count > 0)
            lines.push(`${agent.uncommitted_count} uncommitted`);

        return lines.join('\n');
    }

    _formatDuration(secs) {
        if (secs < 60) return `${secs}с`;
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        if (m < 60) return s > 0 ? `${m}м ${s}с` : `${m}м`;
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return rm > 0 ? `${h}ч ${rm}м` : `${h}ч`;
    }

    _setDotState(dot, state) {
        const states = ['started', 'awaiting', 'working', 'processing', 'completed', 'ended'];
        for (const s of states)
            dot.remove_style_class_name(`agent-dot-${s}`);
        dot.add_style_class_name(`agent-dot-${state}`);
    }

    _setDotType(dot, agentType) {
        for (const [, typeInfo] of Object.entries(AGENT_TYPES)) {
            if (typeInfo.dotClass)
                dot.remove_style_class_name(typeInfo.dotClass);
        }
        const typeInfo = AGENT_TYPES[agentType];
        if (typeInfo?.dotClass)
            dot.add_style_class_name(typeInfo.dotClass);
    }
}
