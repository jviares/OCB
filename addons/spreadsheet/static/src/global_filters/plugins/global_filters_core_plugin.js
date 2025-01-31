/** @odoo-module */

/**
 * @typedef {"fixedPeriod"|"relative"|"from_to"} RangeType
 *
 * @typedef {"last_month" | "last_week" | "last_year" | "last_three_years" | "this_month" | "this_quarter" | "this_year"} RelativePeriod
 *
 * @typedef {Object} FieldMatching
 * @property {string} chain name of the field
 * @property {string} type type of the field
 * @property {number} [offset] offset to apply to the field (for date filters)
 *
 * @typedef {Object} GlobalFilter
 * @property {string} id
 * @property {string} label
 * @property {string} type "text" | "date" | "relation"
 * @property {RangeType} [rangeType]
 * @property {boolean} [automaticDefaultValue]
 * @property {RelativePeriod | "current_user" | string[] | string | undefined} defaultValue can be a period (for date filters), a list of ids (for relation filters) or simple text (for text filters)
 * @property {number} [modelID] ID of the related model
 * @property {string} [modelName] Name of the related model
 */

export const globalFiltersFieldMatchers = {};

import * as spreadsheet from "@odoo/o-spreadsheet";
import { CommandResult } from "@spreadsheet/o_spreadsheet/cancelled_reason";
import { checkFiltersTypeValueCombination } from "@spreadsheet/global_filters/helpers";
import { _t } from "@web/core/l10n/translation";
import { escapeRegExp } from "@web/core/utils/strings";

export class GlobalFiltersCorePlugin extends spreadsheet.CorePlugin {
    constructor(config) {
        super(config);
        /** @type {Array.<GlobalFilter>} */
        this.globalFilters = [];
    }

    /**
     * Check if the given command can be dispatched
     *
     * @param {Object} cmd Command
     */
    allowDispatch(cmd) {
        switch (cmd.type) {
            case "EDIT_GLOBAL_FILTER":
                if (!this.getGlobalFilter(cmd.filter.id)) {
                    return CommandResult.FilterNotFound;
                } else if (this._isDuplicatedLabel(cmd.filter.id, cmd.filter.label)) {
                    return CommandResult.DuplicatedFilterLabel;
                }
                return checkFiltersTypeValueCombination(cmd.filter.type, cmd.filter.defaultValue);
            case "REMOVE_GLOBAL_FILTER":
                if (!this.getGlobalFilter(cmd.id)) {
                    return CommandResult.FilterNotFound;
                }
                break;
            case "ADD_GLOBAL_FILTER":
                if (this._isDuplicatedLabel(cmd.filter.id, cmd.filter.label)) {
                    return CommandResult.DuplicatedFilterLabel;
                }
                return checkFiltersTypeValueCombination(cmd.filter.type, cmd.filter.defaultValue);
            case "MOVE_GLOBAL_FILTER": {
                const index = this.globalFilters.findIndex((filter) => filter.id === cmd.id);
                if (index === -1) {
                    return CommandResult.FilterNotFound;
                }
                const targetIndex = index + cmd.delta;
                if (targetIndex < 0 || targetIndex >= this.globalFilters.length) {
                    return CommandResult.InvalidFilterMove;
                }
                break;
            }
        }
        return CommandResult.Success;
    }

    /**
     * Handle a spreadsheet command
     *
     * @param {Object} cmd Command
     */
    handle(cmd) {
        switch (cmd.type) {
            case "ADD_GLOBAL_FILTER":
                this.history.update("globalFilters", [...this.globalFilters, cmd.filter]);
                break;
            case "EDIT_GLOBAL_FILTER":
                this._editGlobalFilter(cmd.filter);
                break;
            case "REMOVE_GLOBAL_FILTER": {
                const filters = this.globalFilters.filter((filter) => filter.id !== cmd.id);
                this.history.update("globalFilters", filters);
                break;
            }
            case "MOVE_GLOBAL_FILTER":
                this._onMoveFilter(cmd.id, cmd.delta);
                break;
        }
    }

    // ---------------------------------------------------------------------
    // Getters
    // ---------------------------------------------------------------------

    /**
     * Retrieve the global filter with the given id
     *
     * @param {string} id
     * @returns {GlobalFilter|undefined} Global filter
     */
    getGlobalFilter(id) {
        return this.globalFilters.find((filter) => filter.id === id);
    }

    /**
     * Get the global filter with the given name
     *
     * @param {string} label Label
     *
     * @returns {GlobalFilter|undefined}
     */
    getGlobalFilterLabel(label) {
        return this.globalFilters.find((filter) => _t(filter.label) === _t(label));
    }

    /**
     * Retrieve all the global filters
     *
     * @returns {Array<GlobalFilter>} Array of Global filters
     */
    getGlobalFilters() {
        return [...this.globalFilters];
    }

    /**
     * Get the default value of a global filter
     *
     * @param {string} id Id of the filter
     *
     * @returns {string|Array<string>|Object}
     */
    getGlobalFilterDefaultValue(id) {
        return this.getGlobalFilter(id).defaultValue;
    }

    /**
     * Returns the field matching for a given model by copying the matchings of another DataSource that
     * share the same model, including only the chain and type.
     */
    getFieldMatchingForModel(newModel) {
        const globalFilters = this.getGlobalFilters();
        if (globalFilters.length === 0) {
            return {};
        }

        for (const matcher of Object.values(globalFiltersFieldMatchers)) {
            for (const dataSourceId of matcher.getIds()) {
                const model = matcher.getModel(dataSourceId);
                if (model === newModel) {
                    const fieldMatching = {};
                    for (const filter of globalFilters) {
                        const matchedField = matcher.getFieldMatching(dataSourceId, filter.id);
                        if (matchedField) {
                            fieldMatching[filter.id] = {
                                chain: matchedField.chain,
                                type: matchedField.type,
                            };
                        }
                    }
                    return fieldMatching;
                }
            }
        }
        return {};
    }

    // ---------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------

    /**
     * Edit a global filter
     *
     * @param {string} id Id of the filter to update
     * @param {GlobalFilter} newFilter
     */
    _editGlobalFilter(newFilter) {
        const id = newFilter.id;
        const currentLabel = this.getGlobalFilter(id).label;
        const index = this.globalFilters.findIndex((filter) => filter.id === id);
        if (index === -1) {
            return;
        }
        this.history.update("globalFilters", index, newFilter);
        const newLabel = this.getGlobalFilter(id).label;
        if (currentLabel !== newLabel) {
            this._updateFilterLabelInFormulas(currentLabel, newLabel);
        }
    }

    // ---------------------------------------------------------------------
    // Import/Export
    // ---------------------------------------------------------------------

    /**
     * Import the filters
     *
     * @param {Object} data
     */
    import(data) {
        for (const globalFilter of data.globalFilters || []) {
            this.globalFilters.push(globalFilter);
        }
    }
    /**
     * Export the filters
     *
     * @param {Object} data
     */
    export(data) {
        data.globalFilters = this.globalFilters.map((filter) => ({
            ...filter,
        }));
    }

    // ---------------------------------------------------------------------
    // Global filters
    // ---------------------------------------------------------------------

    /**
     * Update all ODOO.FILTER.VALUE formulas to reference a filter
     * by its new label.
     *
     * @param {string} currentLabel
     * @param {string} newLabel
     */
    _updateFilterLabelInFormulas(currentLabel, newLabel) {
        const sheetIds = this.getters.getSheetIds();
        currentLabel = escapeRegExp(currentLabel);
        for (const sheetId of sheetIds) {
            for (const cell of Object.values(this.getters.getCells(sheetId))) {
                if (cell.isFormula) {
                    const newContent = cell.content.replace(
                        new RegExp(`FILTER\\.VALUE\\(\\s*"${currentLabel}"\\s*\\)`, "g"),
                        `FILTER.VALUE("${newLabel}")`
                    );
                    if (newContent !== cell.content) {
                        const { col, row } = this.getters.getCellPosition(cell.id);
                        this.dispatch("UPDATE_CELL", {
                            sheetId,
                            content: newContent,
                            col,
                            row,
                        });
                    }
                }
            }
        }
    }

    /**
     * Return true if the label is duplicated
     *
     * @param {string | undefined} filterId
     * @param {string} label
     * @returns {boolean}
     */
    _isDuplicatedLabel(filterId, label) {
        return (
            this.globalFilters.findIndex(
                (filter) => (!filterId || filter.id !== filterId) && filter.label === label
            ) > -1
        );
    }

    _onMoveFilter(filterId, delta) {
        const filters = [...this.globalFilters];
        const currentIndex = filters.findIndex((s) => s.id === filterId);
        const filter = filters[currentIndex];
        const targetIndex = currentIndex + delta;

        filters.splice(currentIndex, 1);
        filters.splice(targetIndex, 0, filter);

        this.history.update("globalFilters", filters);
    }
}

GlobalFiltersCorePlugin.getters = [
    "getGlobalFilter",
    "getGlobalFilters",
    "getGlobalFilterDefaultValue",
    "getGlobalFilterLabel",
    "getFieldMatchingForModel",
];
