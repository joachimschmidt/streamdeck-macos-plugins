import streamDeck from "@elgato/streamdeck";
import { CalendarLcdAction } from "./calendar-lcd-action";

streamDeck.actions.registerAction(new CalendarLcdAction());
streamDeck.connect();
