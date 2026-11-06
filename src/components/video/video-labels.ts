import type { ReportLabels, VideoPlayerLabels } from '@dosya-dev/video-player';
import type { T } from '@/i18n/translator';

/**
 * The video player's own words in the chosen language. The package renders
 * English when it is given no labels; the web app always gives them. Every
 * key is the catalog entry whose `uses` names packages/video-player/src.
 */
export function reportLabels(t: T): ReportLabels {
  return {
    report: t('common.heading.report'),
    back: t('common.back'),
    sending: t('common.status.sending'),
    somethingWentWrong: t('common.error.somethingWentWrongPleaseTryAgain'),
    reportedThanks: t('common.description.reportedThanks'),
    reportedFollowUp: t('common.description.weLlLookAtItAndReplyIfYouLeftAnEmail'),
    formalNotice: t('common.description.fileAFormalNotice'),
    playbackTitle: t('common.heading.videoWonTPlay'),
    playbackSub: t('common.description.weLlGetYourBrowserDetailsAutomatically'),
    playbackHeading: t('common.heading.videoWonTPlay'),
    playbackNote: t('common.description.whatHappensOptional'),
    copyrightTitle: t('common.heading.copyrightDmca'),
    copyrightSub: t('common.description.youOwnThisOrRepresentTheOwner'),
    copyrightHeading: t('common.heading.copyrightClaim'),
    copyrightSend: t('common.action.sendCopyrightReport'),
    abuseTitle: t('common.heading.harmfulOrIllegalContent'),
    abuseSub: t('common.description.removedFastIfConfirmed'),
    abuseHeading: t('common.heading.harmfulContent'),
    abuseNote: t('common.description.whatIsItOptional'),
    send: t('common.action.sendReport'),
    yourEmail: t('common.label.yourEmailSoWeCanReply'),
    sourceUrl: t('common.label.linkToTheOriginalWorkOptional'),
    ownerAttestation: t('common.description.iOwnThisWorkOrIMAuthorizedToActForThe'),
    atTime: (time) => t('common.label.atFormattedvalue', { time }),
    noDecodeError: t('common.label.noDecodeError'),
    decodeError: (code) => t('common.label.decodeErrorDmediaError', { dMedia_error: code }),
    browser: t('common.label.browser'),
    browserOnOs: (browser, os) => t('common.label.browserbrowserOnOs', { browserBrowser: browser, os }),
    detailsTooLong: (max) => t('common.error.detailsMustBeDetailsMaxCharactersOrFewer', { DETAILS_MAX: String(max) }),
    validEmailRequired: t('common.error.validEmailIsRequired'),
    confirmRightsOwner: t('common.error.youMustConfirmYouAreTheRightsOwnerOrTheirAgent'),
  };
}

export function videoLabels(t: T): VideoPlayerLabels {
  return {
    play: t('common.accessibility.play'),
    pause: t('common.accessibility.pause'),
    skipBack: t('common.label.10s'),
    skipForward: t('common.label.10s.10s'),
    loadingVideo: t('common.description.loadingVideo'),
    bufferingFirstFrames: t('common.label.bufferingFirstFrames'),
    cantPlayHere: t('common.error.canTPlayThisVideoHere'),
    couldntLoad: t('common.error.couldnTLoadThisVideo'),
    download: t('common.action.download'),
    reportAProblem: t('common.label.reportAProblem'),
    comment: (excerpt) => t('common.label.commentMlabel', { excerpt }),
    report: t('common.action.report'),
    keyboardShortcuts: t('common.action.keyboardShortcuts'),
    close: t('common.close'),
    shortcutPlayPause: t('common.description.playOrPause'),
    shortcutSeek5: t('common.description.backOrForward5Seconds'),
    shortcutSeek10: t('common.description.backOrForward10Seconds'),
    shortcutVolume: t('common.description.volumeUpOrDown'),
    shortcutMute: t('common.description.mute'),
    shortcutFullscreen: t('common.description.fullscreen'),
    shortcutPip: t('common.description.pictureInPicture'),
    shortcutJump: t('common.description.jumpTo0To90'),
    shortcutShow: t('common.description.showTheseShortcuts'),
    keySpace: t('common.label.space'),
    keyDoubleClick: t('common.label.doubleClick'),
    keyEsc: t('common.label.esc'),
    doubleClickNote: t('common.description.leftOrRightHalf'),
    progressBar: t('common.accessibility.progressBar'),
    currentTime: t('common.accessibility.currentTime'),
    duration: t('common.accessibility.duration'),
    remainingTime: t('common.accessibility.remainingTime'),
    playbackRate: t('common.accessibility.playbackRate'),
    pictureInPicture: t('common.accessibility.pictureInPicture'),
    exitFullscreen: t('common.accessibility.exitFullscreen'),
    reportPopover: reportLabels(t),
  };
}
