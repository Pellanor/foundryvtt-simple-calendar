import {Logger} from "../logging";
import {GameSettings} from "../foundry-interfacing/game-settings";
import {
    CalendarClickEvents,
    DateTimeChangeSocketTypes,
    DateTimeUnits,
    GameWorldTimeIntegrations,
    PresetTimeOfDay,
    SettingNames,
    SocketTypes,
    TimeKeeperStatus
} from "../../constants";
import GameSockets from "../foundry-interfacing/game-sockets";
import Renderer from "../renderer";
import {animateElement, GetIcon, GetThemeName} from "../utilities/visual";
import {CalManager, ConfigurationApplication, MainApplication, NManager, SC} from "../index";
import {AdvanceTimeToPreset, FormatDateTime} from "../utilities/date-time";
import {canUser} from "../utilities/permissions";
import NoteStub from "../notes/note-stub";


/**
 * Contains all functionality for displaying/updating the simple calendar
 */
export default class MainApp extends FormApplication{
    /**
     * The ID used for the application window within foundry
     * @type {string}
     */
    public static appWindowId: string = 'fsc-simple-calendar-application';
    /**
     * Gets the current active calendar
     */
    private get activeCalendar(){
        return CalManager.getActiveCalendar();
    }
    /**
     * Gets the current visible calendar
     */
    private get visibleCalendar(){
        return CalManager.getVisibleCalendar();
    }
    /**
     * The CSS class associated with the animated clock
     */
    clockClass = 'stopped';

    opening = true;


    uiElementStates = {
        "fsc-calendar-list": false,
        "fsc-note-list": false,
        "fsc-note-search": false,
        compactView: false,
        dateTimeUnitOpen: false,
        dateTimeUnit: DateTimeUnits.Day,
        dateTimeUnitText: 'FSC.Day',
        searchOptionsOpen: false,
        calendarListOpen: false,
        primaryCheckRunning: true
    };

    search = {
        term: '',
        results: <NoteStub[]>[],
        options: {
            fields: <SimpleCalendar.Search.OptionsFields>{
                date: true,
                title: true,
                details: true,
                author: true,
                categories: true
            }
        }
    };
    /**
     * Simple Calendar constructor
     */
    constructor() {
        super({});
    }

    /**
     * Initialize the Main Application to pre-set certain values before being rendered.
     */
    initialize() {
        //Check if the note list should always be shown
        this.uiElementStates['fsc-note-list'] = GameSettings.GetBooleanSettings(SettingNames.AlwaysShowNoteList);
    }

    /**
     * Returns the default options for this application
     */
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.template = "modules/foundryvtt-simple-calendar/templates/main.html";
        options.title = "FSC.Title";
        options.classes = ["simple-calendar"];
        options.id = this.appWindowId;
        options.resizable = false;
        return options;
    }

    /**
     * Gets the data object to be used by Handlebars when rending the HTML template
     * @param {Application.RenderOptions | undefined} options The data options
     */
    getData(options?: Application.RenderOptions): Promise<FormApplication.Data<{}>> | FormApplication.Data<{}> {
        let data = {
                ...super.getData(),
                compactViewDisplay: {
                    currentSeasonName: '',
                    currentSeasonIcon: '',
                    selectedDayMoons: <any>[]
                },
                mainViewDisplay: {
                    calendarList: <any>[],
                    search: this.search,
                    showChangeCalendarControls: false
                },
                addNotes: canUser((<Game>game).user, SC.globalConfiguration.permissions.addNotes),
                activeCalendarId: this.activeCalendar.id,
                calendar: this.visibleCalendar.toTemplate(),
                changeDateTime: canUser((<Game>game).user, SC.globalConfiguration.permissions.changeDateTime),
                clockClass: this.clockClass,
                isGM: GameSettings.IsGm(),
                isPrimary: SC.primary,
                message: '',
                uiElementStates: this.uiElementStates,
                reorderNotes: canUser((<Game>game).user, SC.globalConfiguration.permissions.reorderNotes),
                showClock: this.visibleCalendar.generalSettings.showClock,
                showDateControls: false,
                showSetCurrentDate: false,
                showTimeControls: false,
                sideDrawerDirection: GameSettings.GetStringSettings(SettingNames.NoteListOpenDirection)
            };
        //If the active and visible calendar are the same then show the controls as per the usual rules. Other wise do not show any controls
        if(this.activeCalendar.id === this.visibleCalendar.id){
            data.showDateControls = this.activeCalendar.generalSettings.gameWorldTimeIntegration !== GameWorldTimeIntegrations.ThirdParty;
            data.showTimeControls = this.activeCalendar.generalSettings.showClock && this.activeCalendar.generalSettings.gameWorldTimeIntegration !== GameWorldTimeIntegrations.ThirdParty;

            const selectedMonthDayIndex = this.visibleCalendar.getMonthAndDayIndex('selected');
            if(selectedMonthDayIndex.month !== undefined){
                if(selectedMonthDayIndex.day !== undefined){
                    if(!this.visibleCalendar.months[selectedMonthDayIndex.month].days[selectedMonthDayIndex.day].current){
                        data.showSetCurrentDate = canUser((<Game>game).user, SC.globalConfiguration.permissions.changeDateTime);
                    }
                }
            }

        } else if(data.changeDateTime){
            data.message = GameSettings.Localize('FSC.ViewingDifferentCalendar');
        }
        if(this.uiElementStates.compactView){
            const season = this.visibleCalendar.getCurrentSeason();
            data.compactViewDisplay.currentSeasonName = season.name;
            data.compactViewDisplay.currentSeasonIcon = GetIcon(season.icon, season.color, season.color);

            if(this.visibleCalendar.moons.length){
                for(let i = 0; i < this.visibleCalendar.moons.length; i++){
                    const phase = this.visibleCalendar.moons[i].getMoonPhase(this.visibleCalendar, 'current');
                    data.compactViewDisplay.selectedDayMoons.push({
                        name: this.visibleCalendar.moons[i].name,
                        color: this.visibleCalendar.moons[i].color,
                        phase: phase,
                        iconSVG: GetIcon(phase.icon, "#000000", this.visibleCalendar.moons[i].color)
                    });
                }
            }
        } else {
            data.mainViewDisplay.showChangeCalendarControls = canUser((<Game>game).user, SC.globalConfiguration.permissions.changeActiveCalendar);
            data.mainViewDisplay.calendarList = CalManager.getAllCalendars().map(c => {
                const cd = c.getCurrentDate();
                const ct = c.time.getCurrentTime();
                return {
                    id: c.id,
                    name: c.name,
                    date: FormatDateTime({year: cd.year, month: cd.month, day: cd.day, hour: 0, minute: 0, seconds: 0}, c.generalSettings.dateFormat.date, c),
                    time: c.generalSettings.showClock? FormatDateTime({year: 0, month: 1, day: 1, hour: ct.hour, minute: ct.minute, seconds: ct.seconds}, c.generalSettings.dateFormat.time, c) : '',
                    clockRunning: c.timeKeeper.getStatus() === TimeKeeperStatus.Started
                };
            });
        }

        return data;
    }

    /**
     * Render the main application. Will open the module in compact mode, where it was last positioned and using the correct theme
     * @param force
     * @param options
     */
    render(force?: boolean, options?: Application.RenderOptions<FormApplicationOptions>): unknown {
        if(canUser((<Game>game).user, SC.globalConfiguration.permissions.viewCalendar)){
            if(this.visibleCalendar.timeKeeper.getStatus() !== TimeKeeperStatus.Started) {
                //this.visibleCalendar.setCurrentToVisible();
            }
            const options:  Application.RenderOptions = {}
            if(this.opening){
                this.uiElementStates.compactView = GameSettings.GetBooleanSettings(SettingNames.OpenCompact);

                this.opening = false;
            }

            options.classes = ["simple-calendar", GetThemeName()];
            return super.render(true, options);
        }
        return;
    }

    override close(options?: FormApplication.CloseOptions): Promise<void> {
        this.opening = true;
        return super.close(options);
    }

    /**
     * Overwrite the minimization function to reduce the calendar down to the compact form
     * If the calendar is already in the compact form, restore to the full form
     */
    async minimize(){
        this.uiElementStates.compactView = !this.uiElementStates.compactView;
        this.visibleCalendar.resetMonths('selected');
        this.hideDrawers();
        this.render(true);
    }

    /**
     * Overwrite the maximize function to set the calendar to its full form
     */
    async maximize(){
        this.uiElementStates.compactView = false;
        this.hideDrawers();
        this.render(true);
    }

    /**
     * Sets the width and height of the calendar window so that it is sized to show the calendar, the controls and space for 2 notes.
     */
    public static setWidthHeight(ma: MainApp){
        let width = 0, height = 0;
        const main = <HTMLElement>document.querySelector(`#${MainApp.appWindowId}`);
        if(main){
            const header = <HTMLElement>main.querySelector('.window-header');
            if(header){
                height += header.offsetHeight;
            }
            const wrapper = <HTMLElement>main.querySelector('.fsc-main-wrapper');
            if(wrapper) {
                if (ma.uiElementStates.compactView) {
                    wrapper.querySelectorAll('.fsc-section').forEach(e => {
                        height += (<HTMLElement>e).offsetHeight
                    });
                    width = 300;
                } else {
                    wrapper.querySelectorAll(".fsc-section").forEach((s, index) => {
                        height += (<HTMLElement>s).offsetHeight;
                    });
                    const minCalendarWidth = 200;
                    const currentDate = <HTMLElement>wrapper.querySelector('.fsc-calendar .fsc-calendar-header .fsc-current-date');
                    const week = <HTMLElement>wrapper.querySelector('.fsc-calendar .fsc-days .fsc-week');
                    const clock = <HTMLElement>wrapper.querySelector('.fsc-clock-display .fsc-clock');
                    const yearView = <HTMLElement>wrapper.querySelector('.fsc-year-view');
                    let weekWidth = 0, clockWidth = 0, yearViewWidth = 0;

                    if(yearView){
                        yearViewWidth = yearView.offsetWidth;
                        yearViewWidth += 16; //Spacing between calendars
                    }
                    if (week) {
                        weekWidth = week.offsetWidth < minCalendarWidth? minCalendarWidth : week.offsetWidth;
                        if (currentDate) {
                            currentDate.style.maxWidth = `${weekWidth}px`;
                        }
                    } else if (currentDate) {
                        Array.from(currentDate.children).forEach(c => {
                            weekWidth += (<HTMLElement>c).offsetWidth;
                        });
                        weekWidth += 20; //Margins on prev/next buttons
                    }
                    if (clock) {
                        Array.from(clock.children).forEach(c => {
                            clockWidth += (<HTMLElement>c).offsetWidth;
                        });
                        clockWidth += 8; //Clock Icon Margin
                    }
                    width = Math.max(weekWidth, clockWidth, yearViewWidth);
                    width += 10; //Calendar Padding
                    width += 70; //Action list width + Margin


                }
                //Add in the border thickness for the main app
                const appWindowBorder = parseInt(window.getComputedStyle(main).borderWidth);
                if(!isNaN(appWindowBorder)){
                    height += appWindowBorder * 2;
                    width += appWindowBorder * 2;
                }
                //Add in our wrapper padding
                const wrapperCompStyle = window.getComputedStyle(wrapper);
                const paddingTop = parseInt(wrapperCompStyle.paddingTop);
                const paddingBottom = parseInt(wrapperCompStyle.paddingBottom);
                const paddingLeft = parseInt(wrapperCompStyle.paddingLeft);
                const paddingRight = parseInt(wrapperCompStyle.paddingRight);
                height += (paddingTop || 0) + (paddingBottom || 0);
                width += (paddingLeft || 0) + (paddingRight || 0);

                //Add in the padding for the window-content section.
                const section = <HTMLElement>main.querySelector('.window-content');
                if(section){
                    const sectionCompStyle = window.getComputedStyle(section);
                    const paddingTop = parseInt(sectionCompStyle.paddingTop);
                    const paddingBottom = parseInt(sectionCompStyle.paddingBottom);
                    const paddingLeft = parseInt(sectionCompStyle.paddingLeft);
                    const paddingRight = parseInt(sectionCompStyle.paddingRight);
                    const borderTop = parseInt(sectionCompStyle.borderTop);
                    const borderBottom = parseInt(sectionCompStyle.borderBottom);
                    const borderLeft = parseInt(sectionCompStyle.borderLeft);
                    const borderRight = parseInt(sectionCompStyle.borderRight);
                    height += (paddingTop || 0) + (paddingBottom || 0) + (borderTop || 0) + (borderBottom || 0);
                    width += (paddingLeft || 0) + (paddingRight || 0) + (borderLeft || 0) + (borderRight || 0);
                }
            }

            const options:  Partial<Application.Position> = {};
            if(ma.uiElementStates.compactView && GameSettings.GetBooleanSettings(SettingNames.RememberCompactPosition)){
                const pos = <SimpleCalendar.AppPosition>GameSettings.GetObjectSettings(SettingNames.AppCompactPosition);
                if(pos.top !== undefined && pos.top >= 0){
                    options.top = pos.top;
                }
                if(pos.left !== undefined && pos.left >= 0){
                    options.left = pos.left;
                }
            } else if(GameSettings.GetBooleanSettings(SettingNames.RememberPosition)){
                const pos = <SimpleCalendar.AppPosition>GameSettings.GetObjectSettings(SettingNames.AppPosition);
                if(pos.top !== undefined && pos.top >= 0){
                    options.top = pos.top;
                }
                if(pos.left !== undefined && pos.left >= 0){
                    options.left = pos.left;
                }
            }
            //Foundry does weird things if you pass in a height with a top, so we have to do these changes in a specific order
            //depending on which view we are entering.
            if(ma.uiElementStates.compactView){
                ma.setPosition({height: height, width: width});
                if(GameSettings.GetBooleanSettings(SettingNames.RememberCompactPosition)){
                    ma.setPosition(options);
                }
            } else {
                if(GameSettings.GetBooleanSettings(SettingNames.RememberPosition)){
                    ma.setPosition(options);
                }
                ma.setPosition({height: height, width: width});
            }
        }
    }

    /**
     * Keeps the current/selected date centered in the list of days for a month on calendars that have very long day lists
     */
    ensureCurrentDateIsVisible(){
        const calendar = document.querySelector(`#${this.id} .fsc-calendar`);
        const calendarHeight = (<HTMLElement>calendar)?.offsetHeight;

        //This only needs to be processed if the calendar is more than 499px tall
        if(calendar && calendarHeight && calendarHeight >= 500){
            const currentDay = calendar.querySelector('.fsc-day.fsc-current');
            const selectedDay = calendar.querySelector('.fsc-day.fsc-selected');

            //Prefer to use the selected day as the main day to focus on rather than the current day
            let elementToUse = null;
            if(selectedDay){
                elementToUse = selectedDay;
            } else if(currentDay){
                elementToUse = currentDay;
            }

            if(elementToUse !== null){
                const calendarRect = calendar.getBoundingClientRect();
                const rect = elementToUse.getBoundingClientRect();
                const insideViewPort = rect.top >= calendarRect.top && rect.left >= calendarRect.left && rect.bottom <= calendarRect.bottom && rect.right <= calendarRect.right;
                if(!insideViewPort){
                    calendar.scrollTop = rect.top - calendarRect.top - (calendarHeight/ 2);
                }
            }
        }
    }

    /**
     * Process the drag move of the application moving around
     * @param e
     */
    public appDragMove(e: Event){
        //@ts-ignore
        this._onDragMouseMove(e);
    }

    /**
     * Process the drag end of the application moving around
     * @param e
     */
    public appDragEnd(e: Event){
        //@ts-ignore
        this._onDragMouseUp(e);
        const app = document.getElementById(MainApp.appWindowId);
        if(app){
            const appPos: SimpleCalendar.AppPosition = {};
            if(app.classList.contains('fsc-compact-view')){
                appPos.top = parseFloat(app.style.top);
                appPos.left = parseFloat(app.style.left);
                GameSettings.SaveObjectSetting(SettingNames.AppCompactPosition, appPos, false).catch(Logger.error);
            } else {
                appPos.top = parseFloat(app.style.top);
                appPos.left = parseFloat(app.style.left);
                GameSettings.SaveObjectSetting(SettingNames.AppPosition, appPos, false).catch(Logger.error);
            }
        }
    }

    /**
     * Adds any event listeners to the application DOM
     */
    public activateListeners() {
        this.ensureCurrentDateIsVisible();

        const appWindow = document.getElementById(MainApp.appWindowId);
        if(appWindow){
            //Window Drag Listener
             const header = appWindow.querySelector('header');
             if(header){
                 const drag = new Draggable(this, jQuery(appWindow), header, this.options.resizable);
                 drag.handlers["dragMove"] = ["mousemove", this.appDragMove.bind(drag), false];
                 drag.handlers["dragUp"] = ["mouseup", this.appDragEnd.bind(drag), false];
             }

            // Click anywhere in the app
            appWindow.addEventListener('click', this.toggleUnitSelector.bind(this, true));

            if(this.uiElementStates.compactView){
                appWindow.classList.add('fsc-compact-view');
            } else {
                appWindow.classList.remove('fsc-compact-view');
                // Activate the full calendar display listeners
                Renderer.CalendarFull.ActivateListeners(`sc_${this.visibleCalendar.id}_calendar`, this.changeMonth.bind(this), this.dayClick.bind(this));
            }
            // Activate the clock listeners
            Renderer.Clock.ActivateListeners(`sc_${this.visibleCalendar.id}_clock`);

            //-----------------------
            // Calendar Action List
            //-----------------------
            // Calendar List Click
            appWindow.querySelector(".fsc-actions-list .fsc-calendars")?.addEventListener('click', this.toggleDrawer.bind(this, 'fsc-calendar-list'));
            //Configuration Button Click
            appWindow.querySelector(".fsc-actions-list .fsc-configure-button")?.addEventListener('click', this.configurationClick.bind(this));
            //Search button click
            appWindow.querySelector(".fsc-actions-list .fsc-search")?.addEventListener('click', this.toggleDrawer.bind(this, 'fsc-note-search'));
            // Add new note click
            appWindow.querySelector(".fsc-actions-list .fsc-add-note")?.addEventListener('click', this.addNote.bind(this));
            // Note Drawer Toggle
            appWindow.querySelector(".fsc-actions-list .fsc-notes")?.addEventListener('click', this.toggleDrawer.bind(this, 'fsc-note-list'));
            appWindow.querySelector(".fsc-actions-list .fsc-reminder-notes")?.addEventListener('click', this.toggleDrawer.bind(this, 'fsc-note-list'));
            // Today button click
            appWindow.querySelector('.fsc-actions-list .fsc-today')?.addEventListener('click', this.todayClick.bind(this));
            // Set Current Date
            appWindow.querySelector('.fsc-actions-list .fsc-btn-apply')?.addEventListener('click', this.dateControlApply.bind(this));
            // Real Time Clock
            appWindow.querySelector(".fsc-time-start")?.addEventListener('click', this.startTime.bind(this));
            appWindow.querySelector(".fsc-time-stop")?.addEventListener('click', this.stopTime.bind(this));

            //-----------------------
            // Calendar Drawer
            //-----------------------
            //Calendar Active Click
            const calendarActivate =  appWindow.querySelectorAll('.fsc-calendar-list .fsc-calendar-display .fsc-calendar-actions .fsc-save');

            if(calendarActivate.length){
                calendarActivate.forEach(e => {
                    e.addEventListener('click', this.changeCalendar.bind(this, false));
                });
            }
            //Calendar View Click
            appWindow.querySelectorAll('.fsc-calendar-list .fsc-calendar-display').forEach(e => {
                e.addEventListener('click', this.changeCalendar.bind(this, true));
            });

            //-----------------------
            // Note/Search Drawer
            //-----------------------
            // Note Click/Drag
            appWindow.querySelectorAll(".fsc-note-list .fsc-note").forEach(n => {
                n.addEventListener('click', this.viewNote.bind(this));
                n.addEventListener('drag', this.noteDrag.bind(this));
                n.addEventListener('dragend', this.noteDragEnd.bind(this));
                n.addEventListener('contextmenu', this.noteContext.bind(this));
            });
            appWindow.querySelectorAll(".fsc-note-search .fsc-note-list .fsc-note").forEach(n => {
                n.addEventListener('click', this.viewNote.bind(this));
            });
            //Search Click
            appWindow.querySelector(".fsc-note-search .fsc-search-box .fa-search")?.addEventListener('click', this.searchClick.bind(this));
            //Search Clear Click
            appWindow.querySelector(".fsc-note-search .fsc-search-box .fa-times")?.addEventListener('click', this.searchClearClick.bind(this));
            //Search Input Key Up
            appWindow.querySelector(".fsc-note-search .fsc-search-box input")?.addEventListener('keyup', this.searchBoxChange.bind(this));
            //Search Options Header Click
            appWindow.querySelector(".fsc-note-search .fsc-search-options-header")?.addEventListener('click', this.searchOptionsToggle.bind(this, false));
            //Search Options Fields Change
            appWindow.querySelectorAll(".fsc-note-search .fsc-search-fields input").forEach(n => {
                n.addEventListener('change', this.searchOptionsFieldsChange.bind(this));
            });
            //Context Item Click
            appWindow.querySelectorAll('.fsc-section > .fsc-context-menu .fsc-context-list-action').forEach(e => {
                e.addEventListener('click', this.noteContextClick.bind(this));
            });

            //-----------------------
            // Date/Time Controls
            //-----------------------
            appWindow.querySelectorAll(".fsc-unit-controls .fsc-selector").forEach(s => {
                s.addEventListener('click', this.toggleUnitSelector.bind(this, false));
            });
            appWindow.querySelectorAll(".fsc-unit-controls .fsc-unit-list li").forEach(c => {
                c.addEventListener('click', this.changeUnit.bind(this));
            });
            appWindow.querySelectorAll(".fsc-controls .fsc-control").forEach(c => {
                c.addEventListener('click', this.timeUnitClick.bind(this));
            });
        }
    }

    /**
     * Toggles the passed in side drawer to show or hide
     * @param selector The unique class name of the drawer we want to toggle
     */
    public toggleDrawer(selector: string){
        const alwaysShowNoteList = GameSettings.GetBooleanSettings(SettingNames.AlwaysShowNoteList);
        const hideExcluded = [selector];
        //Exclude the note list from being hidden if the note list is not visible
        if(alwaysShowNoteList && !this.uiElementStates['fsc-note-list']){
           hideExcluded.push('fsc-note-list');
        }
        this.hideDrawers(hideExcluded);
        this.searchOptionsToggle(true);
        const cList = document.querySelector(`#${MainApp.appWindowId} .${selector}`);
        if(cList){
            const member = selector.toLowerCase() as 'fsc-calendar-list' | 'fsc-note-list' | 'fsc-note-search';
            if(alwaysShowNoteList){
                //If the note list was clicked, and it is not visible (another drawer is) then show the note list
                if(member === 'fsc-note-list' && !this.uiElementStates['fsc-note-list']){
                    this.uiElementStates[member] = animateElement(cList, 500, false);
                }
                //If a drawer was clicked that is not the note list, process.
                else if(member !== 'fsc-note-list'){
                    this.uiElementStates[member] = animateElement(cList, 500, false);
                    //If the drawer is now hidden and the note list is not visible, show the note list.
                    if(!this.uiElementStates[member] && !this.uiElementStates['fsc-note-list']){
                        const noteList = document.querySelector(`#${MainApp.appWindowId} .fsc-note-list`);
                        if(noteList){
                            this.uiElementStates['fsc-note-list'] = animateElement(noteList, 500, false);
                        }
                    }
                }
            } else {
                this.uiElementStates[member] = animateElement(cList, 500, false);
            }
        }
    }

    /**
     * Hides all drawers, except one that contains the excluded class
     * @param exclude The unique class name of the drawer to exclude from being hidden
     */
    public hideDrawers(exclude: string[] = []){
        document.querySelectorAll('.fsc-side-drawer').forEach(e => {
            let hide = true;
            for(let i = 0; i < exclude.length; i++){
                if(e.classList.contains(exclude[i])){
                    hide = false;
                }
            }
            if(hide){
                animateElement(e, 500, true);
                const member = e.classList[1].toLowerCase() as 'fsc-calendar-list' | 'fsc-note-list' | 'fsc-note-search';
                this.uiElementStates[member] = false;
            }
        });
    }

    /**
     * Opens and closes the date time unit selector dropdown
     * @param forceHide
     */
    public toggleUnitSelector(forceHide: boolean = false){
        let unitList = document.querySelector(`.fsc-main-wrapper .fsc-unit-list`);
        if(unitList){
            this.uiElementStates.dateTimeUnitOpen = animateElement(unitList, 500, forceHide);
        }
    }

    /**
     * Processes changing the selected time unit for the date/time input
     * @param e
     */
    public changeUnit(e: Event){
        const target = <HTMLElement>e.currentTarget;
        const dataUnit = target.getAttribute('data-unit');
        if(dataUnit){
            let change = false;
            if(dataUnit === 'year'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Year;
                this.uiElementStates.dateTimeUnitText = "FSC.Year";
                change = true;
            } else if(dataUnit === 'month'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Month;
                this.uiElementStates.dateTimeUnitText = "FSC.Month";
                change = true;
            } else if(dataUnit === 'day'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Day;
                this.uiElementStates.dateTimeUnitText = "FSC.Day";
                change = true;
            } else if(dataUnit === 'hour'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Hour;
                this.uiElementStates.dateTimeUnitText = "FSC.Hour";
                change = true;
            } else if(dataUnit === 'minute'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Minute;
                this.uiElementStates.dateTimeUnitText = "FSC.Minute";
                change = true;
            } else if(dataUnit === 'round'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Round;
                this.uiElementStates.dateTimeUnitText = "FSC.Round";
                change = true;
            } else if(dataUnit === 'seconds'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Second;
                this.uiElementStates.dateTimeUnitText = "FSC.Second";
                change = true;
            }
            else if(dataUnit === 'watch'){
                this.uiElementStates.dateTimeUnit = DateTimeUnits.Watch;
                this.uiElementStates.dateTimeUnitText = "FSC.Watch";
                change = true;
            }
            if(change){
                this.updateApp();
            }
        }
    }

    public changeCalendar(visible: boolean, e: Event){
        const target = <HTMLElement>e.currentTarget;
        if(target){
            const wrapper = target.closest('.fsc-calendar-display');
            if(wrapper){
                const calendarId = wrapper.getAttribute('data-calid');
                if(calendarId){
                    if(!visible && this.activeCalendar.id !== calendarId){
                        //If user is not the GM nor the primary GM, send over the socket
                        if(!GameSettings.IsGm() || !SC.primary){
                            if(!(<Game>game).users?.find(u => u.isGM && u.active)){
                                GameSettings.UiNotification((<Game>game).i18n.localize('FSC.Warn.Calendar.NotGM'), 'warn');
                            } else {
                                const socketData = {calendarId: calendarId};
                                GameSockets.emit({type: SocketTypes.setActiveCalendar, data: socketData}).catch(Logger.error);
                            }
                        } else {
                            CalManager.setActiveCalendar(calendarId);
                        }
                    } else if(visible && this.visibleCalendar.id !== calendarId){
                        CalManager.setVisibleCalendar(calendarId);
                    }
                }
            }
        }
    }

    /**
     * Processes the callback from the Calendar Renderer's month change click
     * @param {CalendarClickEvents} clickType What was clicked, previous or next
     * @param {Renderer.CalendarOptions} options The renderer's options associated with the calendar
     */
    public changeMonth(clickType: CalendarClickEvents, options: SimpleCalendar.Renderer.CalendarOptions){
        this.toggleUnitSelector(true);
        this.visibleCalendar.changeMonth(clickType === CalendarClickEvents.previous? -1 : 1);
        MainApp.setWidthHeight(this);
    }

    /**
     * Click event when a users clicks on a day
     * @param options The renderer options for the calendar who's day was clicked
     */
    public dayClick(options: SimpleCalendar.Renderer.CalendarOptions){
        this.toggleUnitSelector(true);
        if(options.selectedDates && options.selectedDates.start.day >= 0 && options.selectedDates.start.month >= 0 && options.selectedDates.start.month < this.visibleCalendar.months.length){
            const selectedDay = options.selectedDates.start.day;
            let allReadySelected = false;
            const currentlySelectedMonth = this.visibleCalendar.getMonth('selected');
            if(currentlySelectedMonth){
                const currentlySelectedDayIndex = currentlySelectedMonth.getDayIndex('selected');
                allReadySelected = currentlySelectedDayIndex === selectedDay && this.visibleCalendar.year.selectedYear === options.selectedDates.start.year;
            }

            this.visibleCalendar.resetMonths('selected');
            if(!allReadySelected){
                const month = this.visibleCalendar.months[options.selectedDates.start.month];
                if(selectedDay > -1){
                    month.selected = true;
                    month.days[selectedDay].selected = true;
                    this.visibleCalendar.year.selectedYear = this.visibleCalendar.year.visibleYear;
                }
            }
            this.updateApp();
        }
    }

    /**
     * Click event when a user clicks on the Today button
     * @param {Event} e The click event
     */
    public todayClick(e: Event) {
        this.visibleCalendar.resetMonths('selected');
        this.visibleCalendar.resetMonths('visible');
        const currentMonth = this.visibleCalendar.getMonth();
        if(currentMonth){
            const currentDay = currentMonth.getDay();
            if(currentDay){
                this.visibleCalendar.year.selectedYear = this.visibleCalendar.year.numericRepresentation;
                this.visibleCalendar.year.visibleYear = this.visibleCalendar.year.numericRepresentation;
                currentMonth.visible = true;
                currentMonth.selected = true;
                currentDay.selected = true;
                this.updateApp();
            }
        }
    }

    /**
     * When the change time unit buttons are clicked
     * @param e
     */
    public timeUnitClick(e: Event){
        const target = <HTMLElement>e.currentTarget;
        const dataType = target.getAttribute('data-type');
        const dataAmount = target.getAttribute('data-amount');

        if(dataType && dataAmount){
            const amount = parseInt(dataAmount);
            if(!isNaN(amount)){
                const interval: SimpleCalendar.DateTimeParts = {};
                if(dataType === 'round'){
                    interval.seconds = amount * SC.globalConfiguration.secondsInCombatRound;
                } else if(dataType === 'seconds' || dataType === 'minute' || dataType === 'hour' || dataType === 'day' || dataType === 'month' || dataType === 'year'){
                    interval[dataType] = amount;
                } else if (dataType === 'watch') {
                    interval['hour'] = amount * SC.globalConfiguration.hoursInWatch;
                }
                //If user is not the GM nor the primary GM, send over the socket
                if(!GameSettings.IsGm() || !SC.primary){
                    if(!(<Game>game).users?.find(u => u.isGM && u.active)){
                        GameSettings.UiNotification((<Game>game).i18n.localize('FSC.Warn.Calendar.NotGM'), 'warn');
                    } else {
                        const socketData = {type: DateTimeChangeSocketTypes.changeDateTime, interval: interval};
                        GameSockets.emit({type: SocketTypes.dateTimeChange, data: socketData}).catch(Logger.error);
                    }
                } else {
                    this.activeCalendar.changeDateTime(interval, {updateMonth: false, showWarning: true});
                }
            }
        } else if(dataType && (dataType === 'sunrise' || dataType === 'midday' || dataType === 'sunset' || dataType === 'midnight')){
            //If user is not the GM nor the primary GM, send over the socket
            if(!GameSettings.IsGm() || !SC.primary){
                if(!(<Game>game).users?.find(u => u.isGM && u.active)){
                    GameSettings.UiNotification((<Game>game).i18n.localize('FSC.Warn.Calendar.NotGM'), 'warn');
                } else {
                    const socketData = {type: DateTimeChangeSocketTypes.advanceTimeToPreset, interval: {}, presetTimeOfDay: <PresetTimeOfDay>dataType};
                    GameSockets.emit({type: SocketTypes.dateTimeChange, data: socketData}).catch(Logger.error);
                }
            } else {
                AdvanceTimeToPreset(<PresetTimeOfDay>dataType, this.activeCalendar).catch(Logger.error);
            }
        }
    }

    /**
     * Click event for when a gm user clicks on the apply button for the current date controls
     * Will attempt to save the new current date to the world settings.
     * @param {Event} e The click event
     */
    public dateControlApply(e: Event){
        if(canUser((<Game>game).user, SC.globalConfiguration.permissions.changeDateTime)){
            let validSelection = false;
            const selectedYear = this.activeCalendar.year.selectedYear;
            const selectedMonthDayIndex = this.activeCalendar.getMonthAndDayIndex('selected');
            const selectedMonth = this.activeCalendar.getMonth('selected');
            if(selectedMonth){
                validSelection = true;
                if(selectedYear !== this.activeCalendar.year.visibleYear || !selectedMonth.visible){
                    const utsd = new Dialog({
                        title: GameSettings.Localize('FSC.SetCurrentDateDialog.Title'),
                        content: GameSettings.Localize('FSC.SetCurrentDateDialog.Content').replace('{DATE}', FormatDateTime({year: selectedYear, month: selectedMonthDayIndex.month || 0, day: selectedMonthDayIndex.day || 0, hour: 0, minute: 0, seconds: 0}, "MMMM DD, YYYY", this.activeCalendar)),
                        buttons:{
                            yes: {
                                label: GameSettings.Localize('Yes'),
                                callback: this.setCurrentDate.bind(this, selectedYear, selectedMonthDayIndex.month || 0, selectedMonthDayIndex.day || 0)
                            },
                            no: {
                                label: GameSettings.Localize('No')
                            }
                        },
                        default: "no"
                    });
                    utsd.render(true);
                } else {
                    this.setCurrentDate(selectedYear, selectedMonthDayIndex.month || 0, selectedMonthDayIndex.day || 0);
                }
            }
        } else {
            GameSettings.UiNotification(GameSettings.Localize("FSC.Error.Calendar.GMCurrent"), 'warn');
        }
    }

    /**
     * Sets the current date for the calendar
     * @param {number} year The year number to set the date to
     * @param {Month} monthIndex The month object to set as current
     * @param {Day} dayIndex They day object to set as current
     */
    public setCurrentDate(year: number, monthIndex: number, dayIndex: number){
        if(!GameSettings.IsGm() || !SC.primary){
            if(!(<Game>game).users?.find(u => u.isGM && u.active)){
                GameSettings.UiNotification((<Game>game).i18n.localize('FSC.Warn.Calendar.NotGM'), 'warn');
            } else {
                const socketData = {type: DateTimeChangeSocketTypes.setDate, interval: {year: year, month: monthIndex, day: dayIndex}};
                GameSockets.emit({type: SocketTypes.dateTimeChange, data: socketData}).catch(Logger.error);
            }
        } else {
            this.activeCalendar.setDateTime({year: year, month: monthIndex, day: dayIndex},{updateApp: false, showWarning: true});
        }
    }

    /**
     * When the search button next to the search box is clicked, or the enter key is used on the search input
     */
    public searchClick() {
        const searchInput = <HTMLInputElement>document.getElementById('simpleCalendarSearchBox');
        if(searchInput){
            this.search.term = searchInput.value;
            this.search.results = [];
            if(this.search.term){
                this.search.results = NManager.searchNotes(this.visibleCalendar.id, this.search.term, this.search.options.fields);
            }
            this.updateApp();
        }
    }

    /**
     * Clears the search terms and results.
     */
    public searchClearClick(){
        this.search.term = '';
        this.search.results = [];
        this.updateApp();
    }

    /**
     * Processes text input into the search box.
     * @param e
     */
    public searchBoxChange(e: Event){
        if((<KeyboardEvent>e).key === "Enter"){
            this.searchClick();
        } else {
            this.search.term = (<HTMLInputElement>e.target).value;
        }
    }

    /**
     * Opens and closes the search options area
     * @param forceClose
     */
    public searchOptionsToggle(forceClose: boolean = false){
        let so = document.querySelector(`.fsc-note-search .fsc-search-options`);
        if(so){
            this.uiElementStates.searchOptionsOpen = animateElement(so, 500, forceClose);
        }
    }

    /**
     * Processes the checking/unchecking of search options fields inputs
     * @param e
     */
    public searchOptionsFieldsChange(e: Event){
        const element = <HTMLInputElement>e.target;
        if(element){
            const field = element.getAttribute('data-field');
            if(field && this.search.options.fields.hasOwnProperty(field)){
                this.search.options.fields[field as keyof SimpleCalendar.Search.OptionsFields] = element.checked;
            }
        }
    }

    /**
     * Click event for when a gm user clicks on the configuration button to configure the game calendar
     * @param {Event} e The click event
     */
    public configurationClick(e: Event) {
        ConfigurationApplication.initializeAndShowDialog().catch(Logger.error);
    }

    /**
     * Opens up the note adding dialog
     * @param {Event} e The click event
     */
    public addNote(e: Event) {
        NManager.addNewNote(this.visibleCalendar, 'New Note').catch(Logger.error);
    }

    /**
     * Opens up a note to view the contents
     * @param {Event} e The click event
     */
    public viewNote(e: Event){
        const dataIndex = (<HTMLElement>e.currentTarget).getAttribute('data-index');
        if(dataIndex){
            NManager.showNote(dataIndex);
        } else {
            Logger.error('No Data index on note element found.');
        }
    }

    public noteContext(e: Event){
        const note = <HTMLElement>(<HTMLElement>e.target)?.closest('.fsc-note');
        const noteID = note?.getAttribute('data-index');
        if(note && noteID){
            const journalEntry = (<Game>game).journal?.get(noteID);
            if(journalEntry){
                const sidebarSection = note.closest('.fsc-section')?.querySelector(':scope > .fsc-context-menu');
                const appWindow = <HTMLElement>document.getElementById(MainApp.appWindowId);
                if(appWindow && sidebarSection){
                    sidebarSection.classList.remove('fsc-hide');
                    const y = (<PointerEvent>e).y - appWindow.offsetTop;
                    (<HTMLElement>sidebarSection).style.top = `${y}px`;
                    const noteStub = NManager.getNoteStub(journalEntry);
                    sidebarSection.setAttribute('data-id', noteID);
                    if(noteStub){
                        //Hide items the player shouldn't see
                        sidebarSection.querySelectorAll('div[data-action="edit"], div[data-action="delete"], .fsc-context-list-break').forEach(e => { if(noteStub.canEdit){e.classList.remove('fsc-hide');}else{e.classList.add('fsc-hide');} });
                        //Reset the bottom margin of all elements then set the bottom margin of the last visible item
                        const visibleItems = sidebarSection.querySelectorAll('.fsc-day-context-list div:not(.fsc-hide)');
                        if(visibleItems.length){
                            visibleItems.forEach(e => (<HTMLElement>e).style.marginBottom = '');
                            (<HTMLElement>visibleItems[visibleItems.length - 1]).style.marginBottom = '0';
                        }
                        //Update the reminder button to show the appropriate text and icon
                        const reminderAction = sidebarSection.querySelector('.fsc-context-list-action[data-action="remind"]');
                        if(reminderAction){
                            reminderAction.innerHTML = `<span class="fa ${noteStub.userReminderRegistered? 'fa-bell-slash' : 'fa-bell'}"></span>${noteStub.userReminderRegistered? GameSettings.Localize('FSC.Notes.ReminderCancel') : GameSettings.Localize('FSC.Notes.Reminder')}`;
                        }
                    }
                }
            }
        }
        return false;
    }

    public noteContextClick(e: Event){
        const target = <HTMLElement>e.target;
        const action = target?.getAttribute('data-action');
        if(target && action){
            const contextMenu = target.closest('.fsc-context-menu');
            const noteId = contextMenu?.getAttribute('data-id');
            if(noteId){
                const journalEntry = (<Game>game).journal?.get(noteId);
                if(journalEntry){
                    if(action === 'showPlayers'){
                        //@ts-ignore
                        Journal.showDialog(journalEntry).catch(e => console.error(e));
                    } else if(action === 'delete'){
                        //@ts-ignore
                        journalEntry.sheet?.delete(e);
                    } else if(action === 'edit'){
                        //@ts-ignore
                        journalEntry.sheet?.render(true, {}, true);
                    } else if(action === 'remind'){
                        //@ts-ignore
                        journalEntry.sheet?.reminderChange(false).catch(e => console.error(e));

                    }
                }
            }
        }
    }

    /**
     * Re-renders the application window
     * @private
     */
    public updateApp(){
        if(this.rendered){
            this.render(true, {});
        }
    }

    //---------------------------
    // Time Keeper
    //---------------------------

    /**
     * Starts the built-in timekeeper
     */
    startTime(){
        const activeScene = GameSettings.GetSceneForCombatCheck();
        const combats = (<Game>game).combats;
        if(combats && combats.size > 0 && combats.find(g => g.started && ((activeScene !== null && g.scene && g.scene.id === activeScene.id) || activeScene === null))){
            GameSettings.UiNotification((<Game>game).i18n.localize('FSC.Warn.Time.ActiveCombats'), 'warn');
        } else if(this.activeCalendar.generalSettings.gameWorldTimeIntegration === GameWorldTimeIntegrations.None || this.activeCalendar.generalSettings.gameWorldTimeIntegration === GameWorldTimeIntegrations.Self || this.activeCalendar.generalSettings.gameWorldTimeIntegration === GameWorldTimeIntegrations.Mixed){
            this.activeCalendar.timeKeeper.start();
            this.clockClass = this.activeCalendar.timeKeeper.getStatus();
            this.updateApp();
        }
    }

    /**
     * Stops the built-in timekeeper
     */
    stopTime(){
        this.activeCalendar.timeKeeper.stop();
        this.clockClass = this.activeCalendar.timeKeeper.getStatus();
        this.updateApp();
    }

    /**
     * Checks to see if the module import/export dialog needs to be shown and syncs the game world time with the simple calendar
     */
    async timeKeepingCheck(){
        //If the current year is set up and the calendar is set up for time keeping and the user is the GM
        if(this.activeCalendar.generalSettings.gameWorldTimeIntegration !== GameWorldTimeIntegrations.None && GameSettings.IsGm() ){
            //Sync the current world time with the simple calendar
            await this.activeCalendar.syncTime();
        }
    }

    /**
     * While a note is being dragged
     * @param {Event} event
     */
    noteDrag(event: Event){
        const selectedItem = <HTMLElement>event.target,
            list = selectedItem.parentNode,
            x = (<DragEvent>event).clientX,
            y = (<DragEvent>event).clientY;
        selectedItem.classList.add('drag-active');
        let swapItem: Element | ChildNode | null = document.elementFromPoint(x, y) === null ? selectedItem : document.elementFromPoint(x, y);
        if (list !== null && swapItem !== null && list === swapItem.parentNode) {
            swapItem = swapItem !== selectedItem.nextSibling ? swapItem : swapItem.nextSibling;
            list.insertBefore(selectedItem, swapItem);
        }
    }

    /**
     * When the dragging has ended, re-order all events on this day and save their new order
     * @param {Event} event
     */
    noteDragEnd(event: Event){
        const selectedItem = <HTMLElement>event.target,
            list = selectedItem.parentNode,
            id = selectedItem.getAttribute('data-index');
        selectedItem.classList.remove('drag-active');
        if(id && list){
            const noteIDOrder: string[] = [];
            for(let i = 0; i < list.children.length; i++){
                const cid = list.children[i].getAttribute('data-index');
                if(cid){
                    noteIDOrder.push(cid);
                }
            }
            if(!GameSettings.IsGm() || !SC.primary){
                if(!(<Game>game).users?.find(u => {return u.isGM && u.active;})){
                    GameSettings.UiNotification((<Game>game).i18n.localize('FSC.Warn.Calendar.NotGM'), 'warn');
                } else {
                    const socketData = {calendarId: this.visibleCalendar.id, date: this.visibleCalendar.getDateTime(), newOrder: noteIDOrder};
                    GameSockets.emit({type: SocketTypes.noteUpdate, data: socketData}).catch(Logger.error);
                }
            } else {
                NManager.orderNotesOnDay(this.visibleCalendar.id, noteIDOrder, this.visibleCalendar.getDateTime()).catch(Logger.error);
            }
        }
    }

    protected _updateObject(event: Event, formData: object | undefined): Promise<unknown> {
        return Promise.resolve(undefined);
    }

}
