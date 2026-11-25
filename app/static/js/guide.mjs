const modeOrder = ["classic", "random", "joker", "undercover", "alliance", "blind", "chaos"];
const randomOutcomes = ["none", "reverse", "all"];
const roleOrder = ["civil", "imposter", "joker", "spy", "accomplice", "double_agent", "undercover"];
const tabletopRoles = ["detective", "guardian"];

export function mountGuide({ root, t, el, modeName, roleName }) {
    function section(name, ...children) {
        const id = `guide-${name}`;
        const titleId = `${id}-title`;
        return el("section", { id, class: "stack guide-section", "aria-labelledby": titleId },
            el("h2", { id: titleId }, t(`guide.${name}.title`)), ...children);
    }

    function modeEntry(mode) {
        const children = [el("p", {}, t(`guide.mode.${mode}`))];
        if (mode === "random") {
            children.push(el("ul", { class: "stack guide-outcomes" }, ...randomOutcomes.map(outcome =>
                el("li", { "data-mode": outcome },
                    el("strong", {}, modeName(outcome)), el("p", {}, t(`guide.mode.${outcome}`))))));
        }
        return el("article", { class: "panel stack guide-entry", "data-mode": mode },
            el("h3", {}, modeName(mode)), ...children);
    }

    function roleEntry(role) {
        return el("article", { class: "panel stack guide-entry", "data-role": role },
            el("h3", {}, roleName(role)), el("p", {}, t(`guide.role.${role}`)));
    }

    const steps = ["setup", "cards", "reveal"].map(step => el("li", { class: "stack guide-step" },
        el("h3", {}, t(`guide.steps.${step}.title`)), el("p", {}, t(`guide.steps.${step}.text`))));
    const optionalRoles = el("details", { class: "panel guide-tabletop" },
        el("summary", {}, t("guide.roles.tabletop")),
        el("div", { class: "stack guide-tabletop__body" },
            el("p", {}, t("guide.roles.tabletopIntro")),
            el("div", { class: "guide-grid" }, ...tabletopRoles.map(roleEntry))));

    root.replaceChildren(el("article", { class: "stack guide", "data-testid": "rules-guide" },
        el("header", { class: "page-header" }, el("h1", {}, t("guide.title"))),
        section("steps", el("ol", { class: "panel stack guide-steps" }, ...steps)),
        section("modes", el("div", { class: "guide-grid" }, ...modeOrder.map(modeEntry))),
        section("roles", el("p", {}, t("guide.roles.intro")),
            el("div", { class: "guide-grid" }, ...roleOrder.map(roleEntry)), optionalRoles)));
}
