import React, { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import AOS from "aos";
import "aos/dist/aos.css";
import "../styles/main.css";
import Navbar from "../components/Navbar";
import HeroSection from "../components/HeroSection";
import AboutSection from "../components/AboutSection";
import StaffBenefits from "../components/StaffBenefits";
import VisionaryProfile from "../components/VisionaryProfile";
import LifeAtSchool from "../components/LifeAtSchool";
import OurBranches from "../components/OurBranches";
import JobList from "../components/JobList";
import Footer from "../components/Footer";
import ApplicationFormModal from "../components/ApplicationFormModal";
import { notify } from "../components/Toaster";
import { getOpenings, getPublicEntities } from "../services/api";
import { resolveEntity } from "../entities";
import { captureAttribution } from "../attribution";

const Home = () => {
  // /dps and /pgos render an entity-specific landing page; / shows everything
  const { entitySlug } = useParams();
  const [openings, setOpenings] = useState([]);
  // Entities added in the admin panel get a landing page too, so the slug is
  // resolved against the live list rather than a hardcoded map alone
  const [entityList, setEntityList] = useState(null);
  const entity = resolveEntity(entitySlug, entityList || []);
  const [selectedOpening, setSelectedOpening] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    AOS.init({
      duration: 800,
      once: true,
    });
    // Record the campaign that brought this visitor in, before any navigation
    captureAttribution();
  }, []);

  useEffect(() => {
    getOpenings()
      .then((res) => setOpenings(res.data.openings))
      .catch(() => {
        notify.error("Could not load job openings. Please refresh the page.");
      });
    getPublicEntities()
      .then((res) => setEntityList(res.data.entities))
      // An empty list still lets the built-in slugs resolve
      .catch(() => setEntityList([]));
  }, []);

  // From a job card: pre-select the opening and open the form popup
  const handleJobApply = (opening) => {
    setSelectedOpening(opening);
    setFormOpen(true);
  };

  // From the hero button: open the form popup with no pre-selection
  const handleApplyClick = () => {
    setSelectedOpening(null);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setSelectedOpening(null);
  };

  const handleFormSuccess = () => {
    setFormOpen(false);
    setSelectedOpening(null);
  };

  // Genuinely unknown slugs fall back to the main page, keeping any branch
  // filter / campaign tags on the URL. Waiting for the entity list first, so a
  // valid slug for a newly created entity is not redirected away mid-load.
  if (entitySlug && !entity && entityList !== null) {
    return <Navigate to={{ pathname: "/", search: window.location.search }} replace />;
  }

  const visibleOpenings = entity
    ? openings.filter((o) => o.school_group === entity.code)
    : openings;

  return (
    <main className="text-gray-800">
      <Navbar entity={entity} />
      <HeroSection onApplyClick={handleApplyClick} entity={entity} />
      <AboutSection entity={entity} />
      <JobList openings={visibleOpenings} onApply={handleJobApply} entity={entity} />
      <VisionaryProfile />
      <StaffBenefits entity={entity} />
      <LifeAtSchool />
      <OurBranches entity={entity} />
      <Footer entity={entity} />

      {formOpen && (
        <ApplicationFormModal
          selectedOpening={selectedOpening}
          openings={visibleOpenings}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </main>
  );
};

export default Home;
