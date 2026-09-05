include Makefile
source_switch_test.o: tests/TestSourceSwitch.cpp
	$(CXX) -c $(CXXFLAGS) $(DEFINES) $(INCPATH) -o $@ $<
source_switch_tests: $(filter-out %/main.o main.o,$(OBJECTS)) source_switch_test.o
	$(LINK) $(LFLAGS) -Wl,-rpath,$(CURDIR)/third_party/macos -o $@ $(filter-out %/main.o main.o,$(OBJECTS)) source_switch_test.o $(OBJCOMP) $(LIBS)
