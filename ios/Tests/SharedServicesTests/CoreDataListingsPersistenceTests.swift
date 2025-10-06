import XCTest
@testable import SharedServices

final class CoreDataListingsPersistenceTests: XCTestCase {
    func testStoresAndLoadsListings() throws {
        let stack = try CoreDataStack(inMemory: true)
        let persistence = CoreDataListingsPersistence(stack: stack)
        let listings = [ListingSummary(id: "1", title: "One", subtitle: "First", price: 12.5, location: "NYC")]

        try persistence.store(listings: listings)
        let cached = try persistence.loadListings()
        XCTAssertEqual(cached.map(\.id), ["1"])
        XCTAssertEqual(cached.map(\.title), ["One"])
    }

    func testClearRemovesListings() throws {
        let stack = try CoreDataStack(inMemory: true)
        let persistence = CoreDataListingsPersistence(stack: stack)
        try persistence.store(listings: [ListingSummary(id: "1", title: "One", subtitle: "", price: nil, location: nil)])
        try persistence.clear()
        let cached = try persistence.loadListings()
        XCTAssertTrue(cached.isEmpty)
    }
}
