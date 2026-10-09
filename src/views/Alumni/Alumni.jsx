"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "../../services";
import styles from "./styles/Alumni.module.scss";
import { TeamCard } from "../../components";
import useWindowWidth from "../../utils/hooks/useWindowWidth";
import MemberData from "../../data/Team.json"; // Local fallback data
import { ComponentLoading } from "../../microInteraction";

const UNKNOWN_SESSION = "Unknown";

// FIX: roll numbers may come as numbers, so coerce to string and check digits
const getSessionFromRollNumber = (rollNumber) => {
  const roll = String(rollNumber ?? "").trim();
  if (!/^\d{2}/.test(roll)) return null;

  const batchYear = parseInt(roll.substring(0, 2), 10);
  const startYear = 2000 + batchYear + 2;

  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

const sortByName = (list) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

const getLocalAlumni = () =>
  sortByName(MemberData.filter((member) => member.access === "ALUMNI"));

// Defined outside Alumni so it isn't re-created (and remounted) on every render
const AlumniSection = ({ alumni }) => {
  const windowWidth = useWindowWidth();
  const membersPerRow = windowWidth < 500 ? 2 : 4;
  const remainderMembersCount = alumni.length % membersPerRow;
  const lastRowMembers =
    remainderMembersCount > 0 ? alumni.slice(-remainderMembersCount) : [];
  const otherMembers =
    remainderMembersCount > 0
      ? alumni.slice(0, -remainderMembersCount)
      : alumni;

  return (
    <div className={styles.alumniSection}>
      <div className={styles.alumniGrid}>
        {otherMembers.map((member) => (
          <TeamCard
            key={member._id || member.rollNumber || member.name}
            member={member}
          />
        ))}
      </div>

      {lastRowMembers.length > 0 && (
        <div className={styles.lastRowCentered}>
          {lastRowMembers.map((member) => (
            <TeamCard
              key={member._id || member.rollNumber || member.name}
              member={member}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Same order as /Team: BODs, Technical, then the rest
const domainOrder = [
  "Board Of Directors",
  "Technical",
  "Creative",
  "Marketing",
  "Operations",
  "PR And Finance",
  "Human Resource",
  "Other / Unclassified",
];

const domainRank = (domain) => {
  const i = domainOrder.indexOf(domain);
  return i === -1 ? domainOrder.length : i;
};

const getDesignation = (member) =>
  (member.extra?.designation ?? member.designation ?? "")
    .toString()
    .trim()
    .toUpperCase();

const getDomainFromDesignation = (designation) => {
  if (!designation) return "Other / Unclassified";

  // FIX: Directors and Deputy Directors are Board members on /Team too.
  // Previously "Director Technical" fell through to the Technical group.
  if (
    designation.includes("BOARD OF DIRECTORS") ||
    designation.includes("DIRECTOR") ||
    designation.includes("PRESIDENT") ||
    /\bBOD\b/.test(designation)
  ) {
    return "Board Of Directors";
  }

  if (designation.includes("TECH")) return "Technical";
  if (designation.includes("CREATIVE")) return "Creative";
  if (designation.includes("MARKETING")) return "Marketing";
  if (designation.includes("OPERATION")) return "Operations";

  // FIX: also catches plain "PR" and "Finance"
  if (
    /\bPR\b/.test(designation) ||
    designation.includes("FINANCE") ||
    designation.includes("PUBLIC RELATIONS")
  ) {
    return "PR And Finance";
  }

  // FIX: old check was "HR " (trailing space), which missed "... HR" at the end
  if (/\bHR\b/.test(designation) || designation.includes("HUMAN RESOURCE")) {
    return "Human Resource";
  }

  return "Other / Unclassified";
};

// Order inside a group, like /Team:
// BOD: President > Vice President > Director > Deputy Director
// Departments: Senior Executives first
const getMemberRank = (domain, designation) => {
  if (domain === "Board Of Directors") {
    if (designation.includes("VICE")) return 1;
    if (designation.includes("PRESIDENT")) return 0;
    if (designation.includes("DEPUTY")) return 3;
    return 2;
  }
  return designation.includes("SENIOR") ? 0 : 1;
};

const sortSessions = (list) =>
  [...list].sort((a, b) => {
    if (a === UNKNOWN_SESSION) return 1; // Unknown always last
    if (b === UNKNOWN_SESSION) return -1;
    return b.localeCompare(a); // newest first
  });

const Alumni = () => {
  const [alumni, setAlumni] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const fetchAlumni = async () => {
      try {
        const response = await api.get("/api/user/fetchAlumni");

        if (response.status === 200) {
          setAlumni(sortByName(response.data.data));
        } else {
          console.error("Error fetching our Alumnis:", response.data.message);
          setError({
            message:
              "Sorry for the inconvenience, we are having issues fetching our Alumni",
          });
          setAlumni(getLocalAlumni());
        }
      } catch (err) {
        console.error("Error fetching our Alumnis:", err);
        setError({
          message:
            "Sorry for the inconvenience, we are having issues fetching our Alumni",
        });
        setAlumni(getLocalAlumni()); // fallback when the request throws
      } finally {
        setIsLoading(false);
      }
    };

    fetchAlumni();
  }, []);

  // Compute session + domain once per member instead of on every filter
  // FIX: members with no valid roll number used to vanish from the page.
  // They now land under an "Unknown" tab so missing data is visible.
  const enriched = useMemo(
    () =>
      alumni.map((member) => {
        const designation = getDesignation(member);
        const domain = getDomainFromDesignation(designation);
        return {
          member,
          session: getSessionFromRollNumber(member.rollNumber) ?? UNKNOWN_SESSION,
          domain,
          rank: getMemberRank(domain, designation),
        };
      }),
    [alumni]
  );

  const sessions = useMemo(
    () => sortSessions([...new Set(enriched.map((e) => e.session))]),
    [enriched]
  );

  useEffect(() => {
    if (sessions.length > 0 && !selectedSession) {
      setSelectedSession(sessions[0]);
    }
  }, [sessions, selectedSession]);

  const groupedAlumni = useMemo(() => {
    const groups = {};

    enriched
      .filter((e) => e.session === selectedSession)
      .forEach((e) => {
        (groups[e.domain] ||= []).push(e);
      });

    return Object.entries(groups)
      .sort(([a], [b]) => domainRank(a) - domainRank(b))
      .map(([domain, items]) => ({
        domain,
        members: items
          .sort(
            (a, b) =>
              a.rank - b.rank || a.member.name.localeCompare(b.member.name)
          )
          .map((e) => e.member),
      }));
  }, [enriched, selectedSession]);

  return (
    <div className={styles.Alumni}>
      <h2>
        Meet Our{" "}
        <span
          style={{
            background: "var(--primary)",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          Alumni
        </span>
      </h2>

      {isLoading ? (
        <ComponentLoading
          customStyles={{
            width: "100%",
            height: "100%",
            display: "flex",
            marginTop: "5rem",
            marginBottom: "10rem",
            justifyContent: "center",
            alignItems: "center",
          }}
        />
      ) : (
        <>
          {error && <div className={styles.error}>{error.message}</div>}

          <div className={styles.sessionButtons}>
            {sessions.map((session) => (
              <button
                key={session}
                onClick={() => setSelectedSession(session)}
                className={
                  selectedSession === session ? styles.activeSession : ""
                }
              >
                {session}
              </button>
            ))}
          </div>

          {groupedAlumni.map(({ domain, members }) => (
            <div key={domain}>
              <h3 className={styles.domainHeading}>{domain}</h3>
              <AlumniSection alumni={members} />
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default Alumni;