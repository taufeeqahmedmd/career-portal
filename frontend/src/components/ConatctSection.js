import React from "react";

const ContactSection = () => {
  return (
    <section className="bg-white py-12 sm:py-16 lg:py-20 px-4 sm:px-6" id="contact">
      <div className="max-w-6xl mx-auto">
        
        {/* Main Card */}
        <div className="bg-[rgb(30,58,138)] rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl">
          <div className="grid lg:grid-cols-2">
            
            {/* Left Side - Contact Info */}
            <div className="p-6 sm:p-10 lg:p-14">
              <span className="inline-block text-white/70 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-3 sm:mb-4">
                Get In Touch
              </span>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-3 sm:mb-4 leading-tight">
                Let's Start a<br />Conversation
              </h2>
              <p className="text-blue-200/70 mb-6 sm:mb-10 leading-relaxed text-sm sm:text-base">
                Interested in joining our team? Reach out to our HR department for career opportunities and inquiries.
              </p>

              {/* Contact Items */}
              <div className="space-y-5 sm:space-y-8">
                {/* Email */}
                <div className="flex items-start sm:items-center gap-3 sm:gap-5">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-blue-300/70 text-xs sm:text-sm mb-1">Email</p>
                    <a 
                      href="mailto:Vandana_hr@pallavimodelschools.org"
                      className="text-white hover:text-blue-200 transition-colors font-medium text-sm sm:text-base break-all sm:break-normal"
                    >
                      Vandana_hr@pallavimodelschools.org
                    </a>
                  </div>
                </div>

                {/* Phone */}
                <div className="flex items-center gap-3 sm:gap-5">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-blue-300/70 text-xs sm:text-sm mb-1">Phone</p>
                    <a 
                      href="tel:+916281094279"
                      className="text-white hover:text-blue-200 transition-colors font-medium text-sm sm:text-base"
                    >
                      +91 628 109 4279
                    </a>
                  </div>
                </div>

                {/* Address */}
                <div className="flex items-start gap-3 sm:gap-5">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-blue-300/70 text-xs sm:text-sm mb-1">Head Office</p>
                    <p className="text-white font-medium text-sm sm:text-base">
                      Pallavi Model School, Bowenpally,<br />
                      Secunderabad, Telangana – 500009
                    </p>
                  </div>
                </div>

                {/* Hours */}
                <div className="flex items-center gap-3 sm:gap-5">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-blue-300/70 text-xs sm:text-sm mb-1">Office Hours</p>
                    <p className="text-white font-medium text-sm sm:text-base">
                      Mon – Sat: 9:00 AM – 5:00 PM
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side - Map */}
            <div className="relative min-h-[300px] sm:min-h-[400px] lg:min-h-full">
              <iframe
                title="Pallavi School Map"
                className="absolute inset-0 w-full h-full"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4182.438622614429!2d78.48814639999999!3d17.468283!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bcb9a64a255c6a3%3A0x1dc4a631e23e632f!2sPallavi%20Model%20School%20-%20Bowenpally!5e1!3m2!1sen!2sin!4v1752559420424!5m2!1sen!2sin"
                allowFullScreen=""
                loading="lazy"
              ></iframe>
              
              {/* Map Overlay Button */}
              {/* <div className="absolute bottom-4 sm:bottom-6 left-4 sm:left-6 right-4 sm:right-6">
                <a 
                  href="https://maps.google.com/?q=Pallavi+Model+School+Bowenpally"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-white text-gray-900 font-semibold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg sm:rounded-xl shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 text-sm sm:text-base"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Get Directions
                </a>
              </div> */}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
