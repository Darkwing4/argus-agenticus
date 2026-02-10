import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { AGENT_TYPES, HOVER_SCALE, MARGIN_DIFFERENT_GROUP, CLICK_PADDING } from './constants.js';

export class Renderer {

    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        this._dotWidgets = new Map();
        this._groupContainers = new Map();
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
        this._logo = new St.Bin({
            style_class: 'argus-logo',
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

    updateDots(agents, callbacks) {
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

            container.style = groupIndex > 0 ? `margin-left: ${MARGIN_DIFFERENT_GROUP}px;` : '';

            for (let i = 0; i < groupAgents.length; i++) {
                const agent = groupAgents[i];
                let widgets = this._dotWidgets.get(agent.session);

                if (!widgets) {
                    widgets = this._createDot(agent, callbacks);
                    this._dotWidgets.set(agent.session, widgets);
                }

                this._setDotState(widgets.dot, agent.state);
                this._setDotType(widgets.dot, agent.agent_type);

                if (widgets.button.get_parent() !== container) {
                    widgets.button.get_parent()?.remove_child(widgets.button);
                    container.add_child(widgets.button);
                }

                container.set_child_at_index(widgets.button, i);
                widgets.button.style = `padding: ${CLICK_PADDING}px;`;
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
            style: 'font-size: 11px;',
        });

        Main.uiGroup.add_child(this._tooltip);

        const [x, y] = anchor.get_transformed_position();
        const [anchorWidth, anchorHeight] = anchor.get_size();
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
    }

    _createDot(agent, callbacks) {
        const button = new St.Button({
            style: `padding: ${CLICK_PADDING}px;`,
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
        dot.set_pivot_point(0.5, 0.5);

        button.set_child(dot);

        button.connect('enter-event', () => {
            dot.set_scale(HOVER_SCALE, HOVER_SCALE);
            this.showTooltip(button, agent.session);
        });

        button.connect('leave-event', () => {
            dot.set_scale(1, 1);
            this.hideTooltip();
        });

        button.connect('clicked', () => {
            callbacks.onDotClicked?.(agent.session);
        });

        return { button, dot };
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
