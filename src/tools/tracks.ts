import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTrackTools(bridgeOptions: BridgeOptions) {
  return {
    add_track: {
      description: "Add a new video or audio track to the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Type of track to add",
          },
          count: {
            type: "number",
            description: "Number of tracks to add (default: 1)",
          },
        },
        required: ["track_type"],
      },
      handler: async (args: { track_type: string; count?: number }) => {
        const count = args.count ?? 1;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var before = ${args.track_type === "video" ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          
          ${args.track_type === "video"
            ? `seq.insertVideoTrackAt(before, ${count});`
            : `seq.insertAudioTrackAt(before, ${count});`
          }
          
          var after = ${args.track_type === "video" ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          
          return __result({
            added: after - before,
            trackType: "${args.track_type}",
            totalTracks: after
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_track: {
      description: "Delete a video or audio track from the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Type of track to delete",
          },
          track_index: {
            type: "number",
            description: "Index of the track to delete (0-based)",
          },
        },
        required: ["track_type", "track_index"],
      },
      handler: async (args: { track_type: string; track_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          ${args.track_type === "video"
            ? `if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
               seq.deleteVideoTrackAt(${args.track_index});`
            : `if (${args.track_index} >= seq.audioTracks.numTracks) return __error("Track index out of range");
               seq.deleteAudioTrackAt(${args.track_index});`
          }
          
          return __result({ deleted: true, trackType: "${args.track_type}", trackIndex: ${args.track_index} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    lock_track: {
      description: "Lock or unlock a video track",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          locked: {
            type: "boolean",
            description: "True to lock, false to unlock",
          },
        },
        required: ["track_index", "locked"],
      },
      handler: async (args: { track_index: number; locked: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          track.setLocked(${args.locked ? 1 : 0});
          
          return __result({ trackIndex: ${args.track_index}, locked: ${args.locked}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    toggle_track_visibility: {
      description: "Toggle a video track's visibility (eye icon)",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          visible: {
            type: "boolean",
            description: "True to show, false to hide",
          },
        },
        required: ["track_index", "visible"],
      },
      handler: async (args: { track_index: number; visible: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          track.setMute(${args.visible ? 0 : 1});

          return __result({ trackIndex: ${args.track_index}, visible: ${args.visible}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_track_mute: {
      description: "Check whether a video or audio track is muted",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Type of track",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
        },
        required: ["track_type", "track_index"],
      },
      handler: async (args: { track_type: string; track_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          ${args.track_type === "video"
            ? `if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
               var track = seq.videoTracks[${args.track_index}];`
            : `if (${args.track_index} >= seq.audioTracks.numTracks) return __error("Track index out of range");
               var track = seq.audioTracks[${args.track_index}];`
          }

          var muted = false;
          try { muted = track.isMuted(); } catch(e) { muted = !!track.mute; }

          return __result({ trackIndex: ${args.track_index}, trackType: "${args.track_type}", trackName: track.name, muted: muted });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_tracks_qe: {
      description: "Remove video and/or audio tracks from the active sequence using QE DOM",
      parameters: {
        type: "object" as const,
        properties: {
          video_track_index: {
            type: "number",
            description: "Video track index to remove (-1 to skip)",
          },
          audio_track_index: {
            type: "number",
            description: "Audio track index to remove (-1 to skip)",
          },
          audio_mono_track_index: {
            type: "number",
            description: "Mono audio track index to remove (-1 to skip, default: -1)",
          },
          audio_51_track_index: {
            type: "number",
            description: "5.1 audio track index to remove (-1 to skip, default: -1)",
          },
        },
        required: ["video_track_index", "audio_track_index"],
      },
      handler: async (args: {
        video_track_index: number;
        audio_track_index: number;
        audio_mono_track_index?: number;
        audio_51_track_index?: number;
      }) => {
        const vIdx = args.video_track_index;
        const aIdx = args.audio_track_index;
        const aMonoIdx = args.audio_mono_track_index ?? -1;
        const a51Idx = args.audio_51_track_index ?? -1;

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");

          qeSeq.removeTracks(${vIdx}, ${aIdx}, ${aMonoIdx}, ${a51Idx});
          return __result({
            removed: true,
            videoTrackIndex: ${vIdx},
            audioTrackIndex: ${aIdx},
            audioMonoTrackIndex: ${aMonoIdx},
            audio51TrackIndex: ${a51Idx}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
