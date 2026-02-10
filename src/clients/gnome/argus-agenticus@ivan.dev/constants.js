export const AGENT_TYPES = {
    claude: {
        wmClasses: ['Ptyxis', 'org.gnome.Ptyxis'],
        dotClass: null,
    },
    cursor: {
        wmClasses: ['Cursor'],
        dotClass: 'agent-dot-cursor',
    },
};

export const ALL_WM_CLASSES = Object.values(AGENT_TYPES).flatMap(t => t.wmClasses);
export const HOVER_SCALE = 1.2;
export const MARGIN_SAME_GROUP = 0;
export const MARGIN_DIFFERENT_GROUP = 6;
export const CLICK_PADDING = 8;
export const RECONNECT_DELAY = 3000;
